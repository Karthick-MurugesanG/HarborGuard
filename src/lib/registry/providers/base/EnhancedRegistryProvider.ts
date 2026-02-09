import { exec } from 'child_process';
import { promisify } from 'util';
import type { Repository } from '@/generated/prisma';

const execAsync = promisify(exec);

/**
 * Cross-platform skopeo binary resolution
 * Windows cannot resolve '.cmd' automatically via Node.js exec
 */
const SKOPEO_BIN =
  process.platform === 'win32'
    ? 'C://tools//skopeo.cmd'
    : 'skopeo';

export interface RateLimit {
  requestsPerHour: number;
  requestsPerMinute: number;
  burstLimit: number;
}

// Import types that will be used in abstract methods
import type {
  RegistryImage,
  ImageTag,
  ImageMetadata,
  ConnectionTestResult,
  ListImagesOptions,
  SearchOptions
} from '../../types';

export abstract class EnhancedRegistryProvider {
  protected repository: Repository;
  private requestQueue: number[] = []; // Track request timestamps for minute limit
  private hourlyRequestCount: number = 0;
  private hourStartTime: number = Date.now();
  private skopeoVersion: string | null = null;

  constructor(repository: Repository) {
    this.repository = repository;
  }

  /* -------------------- ABSTRACT METHODS -------------------- */

  abstract getProviderName(): string;
  abstract getSupportedCapabilities(): string[];
  abstract validateConfiguration(): { valid: boolean; errors: string[] };
  abstract getRateLimits(): RateLimit;
  abstract getAuthHeaders(): Promise<Record<string, string>>;
  abstract getSkopeoAuthArgs(): Promise<string>;
  abstract testConnection(): Promise<ConnectionTestResult>;
  abstract listImages(options?: ListImagesOptions): Promise<RegistryImage[]>;
  abstract getImageMetadata(namespace: string | null, imageName: string): Promise<ImageMetadata>;
  abstract getTags(namespace: string | null, imageName: string): Promise<ImageTag[]>;
  abstract searchImages(query: string, options?: SearchOptions): Promise<RegistryImage[]>;
  
  /* -------------------- LOGGING -------------------- */

  /**
   * Log API requests for debugging
   */
  protected logRequest(method: string, url: string, data?: any): void {
    console.log(`[${this.getProviderName()}] ${method} ${url}`);
    if (data && process.env.NODE_ENV === 'development') {
      console.log(`[${this.getProviderName()}] Request data:`, data);
    }
  }

  /* -------------------- RATE LIMITING -------------------- */

  /**
   * Handle rate limiting for API calls
   * Implements token bucket algorithm for rate limiting
   */
  protected async handleRateLimit(): Promise<void> {
    const rateLimits = this.getRateLimits();
    const now = Date.now();
    
    // 1. Reset hourly count if hour has passed
    if (now - this.hourStartTime > 3600000) { // 1 hour in milliseconds
      this.hourlyRequestCount = 0;
      this.hourStartTime = now;
    }
    
    // 2. Check hourly rate limit
    if (this.hourlyRequestCount >= rateLimits.requestsPerHour) {
      const timeToNextHour = 3600000 - (now - this.hourStartTime);
      console.warn(`[${this.getProviderName()}] Hourly rate limit exceeded. Waiting ${Math.ceil(timeToNextHour / 1000)} seconds...`);
      await new Promise(resolve => setTimeout(resolve, timeToNextHour));
      
      // Reset after waiting
      this.hourlyRequestCount = 0;
      this.hourStartTime = Date.now();
    }
    
    // 3. Clean old requests from queue (older than 1 minute)
    const oneMinuteAgo = now - 60000;
    this.requestQueue = this.requestQueue.filter(timestamp => timestamp > oneMinuteAgo);
    
    // 4. Check minute rate limit
    if (this.requestQueue.length >= rateLimits.requestsPerMinute) {
      const oldestRequest = this.requestQueue[0];
      const timeToWait = 60000 - (now - oldestRequest);
      
      if (timeToWait > 0) {
        console.warn(`[${this.getProviderName()}] Minute rate limit exceeded. Waiting ${Math.ceil(timeToWait / 1000)} seconds...`);
        await new Promise(resolve => setTimeout(resolve, timeToWait));
        
        // Clean queue again after waiting
        const newNow = Date.now();
        const newOneMinuteAgo = newNow - 60000;
        this.requestQueue = this.requestQueue.filter(timestamp => timestamp > newOneMinuteAgo);
      }
    }
    
    // 5. Check burst limit
    if (this.requestQueue.length >= rateLimits.burstLimit) {
      const waitTime = 100; // 100ms between burst requests
      console.warn(`[${this.getProviderName()}] Burst limit reached. Waiting ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // 6. Record this request
    this.requestQueue.push(now);
    this.hourlyRequestCount++;
    
    // 7. Optional: Add small jitter to avoid thundering herd
    if (Math.random() < 0.3) { // 30% chance to add jitter
      const jitter = Math.random() * 50; // 0-50ms jitter
      await new Promise(resolve => setTimeout(resolve, jitter));
    }
  }

  /**
   * Get current rate limit statistics
   */
  getRateLimitStats(): {
    requestsLastMinute: number;
    requestsThisHour: number;
    timeToResetHour: number;
    timeToResetMinute: number;
  } {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const minuteRequests = this.requestQueue.filter(timestamp => timestamp > oneMinuteAgo).length;
    
    const timeToResetHour = 3600000 - (now - this.hourStartTime);
    const timeToResetMinute = this.requestQueue.length > 0 
      ? Math.max(0, 60000 - (now - this.requestQueue[0]))
      : 0;
    
    return {
      requestsLastMinute: minuteRequests,
      requestsThisHour: this.hourlyRequestCount,
      timeToResetHour: Math.max(0, timeToResetHour),
      timeToResetMinute: Math.max(0, timeToResetMinute)
    };
  }

  /**
   * Clear rate limit tracking (useful for testing or resetting)
   */
  clearRateLimitTracking(): void {
    this.requestQueue = [];
    this.hourlyRequestCount = 0;
    this.hourStartTime = Date.now();
  }

  /* -------------------- COMMON HELPERS -------------------- */

  /**
   * Build authentication arguments for skopeo Docker container
   * IMPORTANT: For Docker-based skopeo, we need to pass credentials differently
   */
  protected buildAuthArgs(): string[] {
    const args: string[] = [];
    
    if (this.repository.username && this.repository.encryptedPassword) {
      // For Docker container, we need to pass credentials as environment variables
      // or use --creds flag (if the containerized skopeo supports it)
      args.push(`--creds`);
      args.push(`${this.repository.username}:${this.repository.encryptedPassword}`);
    }
    // For public repositories, don't add any auth args
    // The containerized skopeo doesn't need --no-creds
    
    return args;
  }

  protected buildTlsArgs(): string[] {
    const args: string[] = [];
    if (this.repository.skipTlsVerify) {
      args.push('--tls-verify=false');
    }
    return args;
  }

  /**
   * Build environment variables for Docker-based skopeo
   */
  protected buildDockerEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? 'production'
  };
}


  /**
   * Build a complete skopeo command for Docker container
   */
  protected buildCommand(command: string, ...args: string[]): string {
    const parts = [SKOPEO_BIN];
    
    // Add auth args if any
    const authArgs = this.buildAuthArgs();
    parts.push(...authArgs);
    
    // Add TLS args if any
    const tlsArgs = this.buildTlsArgs();
    parts.push(...tlsArgs);
    
    // Add the subcommand
    parts.push(command);
    
    // Add all other args
    parts.push(...args.filter(arg => arg && arg.trim() !== ''));
    
    // Join with single spaces, removing any extra whitespace
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  protected async runCommand(command: string): Promise<string> {
    console.log(`[${this.getProviderName()}] Running command: ${command}`);
    
    try {
      // For Docker-based skopeo, we need to handle Windows paths specially
      let finalCommand = command;
      
      // If tarPath is a Windows path, we need to convert it for Docker
      if (command.includes('docker-archive:') && command.includes('\\')) {
        // Docker containers need Linux-style paths
        // The workspace directory might be mounted at /workspace
        const winPathMatch = command.match(/docker-archive:(.*?)(\s|$)/);
        if (winPathMatch) {
          const winPath = winPathMatch[1];
          // Convert Windows path to Linux path in Docker container
          // Assuming workspace is mounted at /workspace
          const linuxPath = winPath.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '/workspace');
          finalCommand = command.replace(`docker-archive:${winPath}`, `docker-archive:${linuxPath}`);
          console.log(`[${this.getProviderName()}] Converted Windows path to Docker path: ${linuxPath}`);
        }
      }
      
      const { stdout } = await execAsync(finalCommand, { 
        windowsHide: true,
        env: this.buildDockerEnv()
      });
      return stdout;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[${this.getProviderName()}] Command failed: ${command}`, errorMessage);
      
      // Provide more helpful error messages for common issues
      if (errorMessage.includes('unknown flag')) {
        throw new Error(`Skopeo command failed: Unknown flag. This might be due to version mismatch. Full error: ${errorMessage}`);
      } else if (errorMessage.includes('permission denied')) {
        throw new Error(`Skopeo command failed: Permission denied. Check Docker permissions. Full error: ${errorMessage}`);
      } else if (errorMessage.includes('no such file or directory')) {
        throw new Error(`Skopeo command failed: File not found. Check paths and Docker mounts. Full error: ${errorMessage}`);
      }
      
      throw new Error(
        error instanceof Error ? error.message : 'Command execution failed'
      );
    }
  }

  /* -------------------- SKOPEO OPERATIONS -------------------- */

  /**
   * Inspect an image from registry
   * @param imageRef - Full image reference (e.g., docker.io/library/nginx)
   * @param tag - Optional tag (defaults to 'latest')
   */
  async inspectImage(imageRef: string, tag?: string): Promise<any> {
    // Handle tag: if provided, append it, otherwise use imageRef as-is
    const fullImageRef = tag ? `${imageRef}:${tag}` : imageRef;
    const command = this.buildCommand('inspect', `docker://${fullImageRef}`);
    
    console.log(`[${this.getProviderName()}] Inspecting image: ${fullImageRef}`);
    const output = await this.runCommand(command);
    return JSON.parse(output);
  }

  /**
   * Inspect raw manifest from registry
   * @param imageRef - Full image reference (e.g., docker.io/library/nginx)
   * @param tag - Optional tag (defaults to 'latest')
   */
  async inspectImageRaw(imageRef: string, tag?: string): Promise<any> {
    // Handle tag: if provided, append it, otherwise use imageRef as-is
    const fullImageRef = tag ? `${imageRef}:${tag}` : imageRef;
    const command = this.buildCommand('inspect', '--raw', `docker://${fullImageRef}`);

    const output = await this.runCommand(command);
    return JSON.parse(output);
  }

  /**
   * Get image digest
   * @param imageRef - Full image reference (e.g., docker.io/library/nginx)
   * @param tag - Optional tag (defaults to 'latest')
   */
  async getImageDigest(imageRef: string, tag?: string): Promise<string> {
    const data = await this.inspectImage(imageRef, tag);
    
    // Try to find digest in different possible locations
    if (data.Digest) {
      return data.Digest;
    } else if (data.digest) {
      return data.digest;
    } else if (data.config?.Digest) {
      return data.config.Digest;
    } else if (data.config?.digest) {
      return data.config.digest;
    } else if (data.RepoDigests?.[0]) {
      // Extract digest from RepoDigests (format: "image@sha256:...")
      const repoDigest = data.RepoDigests[0];
      const atIndex = repoDigest.indexOf('@');
      if (atIndex !== -1) {
        return repoDigest.substring(atIndex + 1);
      }
    }
    
    throw new Error(`Could not find digest for image ${imageRef}:${tag || 'latest'}`);
  }

  async listTags(imageName: string): Promise<string[]> {
    const command = this.buildCommand('list-tags', `docker://${imageName}`);

    const output = await this.runCommand(command);
    const parsed = JSON.parse(output);
    return parsed.Tags || [];
  }

  async copyImage(
    sourceImage: string,
    destinationImage: string
  ): Promise<void> {
    const command = this.buildCommand('copy', `docker://${sourceImage}`, `docker://${destinationImage}`);

    await this.runCommand(command);
  }

  /**
   * Pull image to Docker daemon
   * @param imageRef - Full image reference (e.g., docker.io/library/nginx)
   * @param tag - Optional tag (defaults to 'latest')
   * @param tarPath - Optional tar path for saving
   */
  async pullImage(imageRef: string, tag?: string, tarPath?: string): Promise<void> {
    // Handle tag: if provided, append it, otherwise use imageRef as-is
    const fullImageRef = tag ? `${imageRef}:${tag}` : imageRef;
    
    let destination;
    if (tarPath) {
      // IMPORTANT: For Docker-based skopeo, tarPath must be accessible inside the container
      // The path should be within a mounted volume
      destination = `docker-archive:${tarPath}`;
    } else {
      destination = `docker-daemon:${fullImageRef}`;
    }

    const command = this.buildCommand('copy', `docker://${fullImageRef}`, destination);
    console.log(`[${this.getProviderName()}] Pulling image: ${fullImageRef} -> ${destination}`);

    await this.runCommand(command);
  }

  async pushImage(imageRef: string, imageName?: string, tag?: string): Promise<void> {
    const fullImageRef = tag ? `${imageRef}:${tag}` : imageRef;
    const command = this.buildCommand('copy', `docker-daemon:${imageRef}`, `docker://${fullImageRef}`);

    await this.runCommand(command);
  }

  /**
   * Test if skopeo container is working
   */
  async testSkopeoContainer(): Promise<boolean> {
    try {
      // Simple test command
      const command = `${SKOPEO_BIN} --help`;
      console.log(`[${this.getProviderName()}] Testing skopeo container with: ${command}`);
      await execAsync(command, { windowsHide: true, timeout: 10000 });
      return true;
    } catch (error) {
      console.error(`[${this.getProviderName()}] Skopeo container test failed:`, error);
      return false;
    }
  }

  /**
   * Get skopeo version from container
   */
  async getSkopeoVersion(): Promise<string> {
    if (this.skopeoVersion) {
      return this.skopeoVersion;
    }

    try {
      const command = `${SKOPEO_BIN} --version`;
      console.log(`[${this.getProviderName()}] Getting skopeo version from container`);
      const { stdout } = await execAsync(command, { windowsHide: true });
      this.skopeoVersion = stdout.trim();
      console.log(`[${this.getProviderName()}] Skopeo container version: ${this.skopeoVersion}`);
      return this.skopeoVersion;
    } catch (error) {
      console.warn(`[${this.getProviderName()}] Could not get skopeo version from container:`, error);
      this.skopeoVersion = 'unknown (containerized)';
      return this.skopeoVersion;
    }
  }

  /* -------------------- HTTP REQUEST HELPERS -------------------- */

  /**
   * Make authenticated HTTP request
   */
  protected async makeAuthenticatedRequest(url: string, options?: RequestInit): Promise<Response> {
    const authHeaders = await this.getAuthHeaders();
    const headers = {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(options?.headers || {})
    };

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return response;
  }

  /* -------------------- UTILITY METHODS -------------------- */

  /**
   * Format date string
   */
  protected formatDate(dateString: string): Date | undefined {
    if (!dateString) return undefined;
    try {
      return new Date(dateString);
    } catch {
      return undefined;
    }
  }

  /**
   * Parse image name into namespace and image name
   */
  protected parseImageName(fullName: string): { namespace: string | null; imageName: string } {
    const parts = fullName.split('/');
    if (parts.length === 1) {
      return { namespace: null, imageName: parts[0] };
    } else {
      return { namespace: parts[0], imageName: parts.slice(1).join('/') };
    }
  }

  /**
   * Build full name from namespace and image name
   */
  protected buildFullName(namespace: string | null, imageName: string): string {
    return namespace ? `${namespace}/${imageName}` : imageName;
  }
}