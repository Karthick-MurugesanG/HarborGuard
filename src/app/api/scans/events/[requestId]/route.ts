import { NextRequest } from 'next/server';
import { scannerService } from '@/lib/scanner';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> }
) {
  const params = await context.params;
  const { requestId } = params;
  
  // Create a readable stream for SSE
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    start(controller) {
      console.log(`SSE connection established for scan: ${requestId}`);
      
      // Send initial connection event
      const connectEvent = `data: ${JSON.stringify({ 
        type: 'connected', 
        requestId,
        timestamp: new Date().toISOString()
      })}\n\n`;
      controller.enqueue(encoder.encode(connectEvent));
      
      // Subscribe to scan progress updates
      const progressListener = (data: any) => {
        if (data.requestId === requestId) {
          const event = `data: ${JSON.stringify({
            type: 'progress',
            ...data
          })}\n\n`;
          
          try {
            controller.enqueue(encoder.encode(event));
          } catch (error) {
            console.log(`SSE client disconnected for scan: ${requestId}`);
          }
        }
      };
      
      // Register the listener with the scanner service
      scannerService.addProgressListener(progressListener);
      
      // Send current job status if it exists
      const currentJob = scannerService.getScanJob(requestId);
      if (currentJob) {
        const statusEvent = `data: ${JSON.stringify({
          type: 'progress',
          requestId: currentJob.requestId,
          scanId: currentJob.scanId,
          status: currentJob.status,
          progress: currentJob.progress || 0,
          error: currentJob.error,
          timestamp: new Date().toISOString()
        })}\n\n`;
        controller.enqueue(encoder.encode(statusEvent));
      }
      
      // Handle client disconnect
      const cleanup = () => {
        console.log(`SSE cleanup for scan: ${requestId}`);
        scannerService.removeProgressListener(progressListener);
        try {
          controller.close();
        } catch (error) {
          // Controller already closed
        }
      };
      
      // Cleanup on abort signal
      request.signal.addEventListener('abort', cleanup);
      
      // Cleanup on error
      controller.error = cleanup;
      
      // Send periodic heartbeat to detect disconnections
      const heartbeat = setInterval(() => {
        try {
          const heartbeatEvent = `data: ${JSON.stringify({ 
            type: 'heartbeat', 
            timestamp: new Date().toISOString() 
          })}\n\n`;
          controller.enqueue(encoder.encode(heartbeatEvent));
        } catch (error) {
          clearInterval(heartbeat);
          cleanup();
        }
      }, 30000); // Every 30 seconds
      
      // Clear heartbeat on cleanup
      const originalCleanup = cleanup;
      const cleanupWithHeartbeat = () => {
        clearInterval(heartbeat);
        originalCleanup();
      };
      
      request.signal.removeEventListener('abort', cleanup);
      request.signal.addEventListener('abort', cleanupWithHeartbeat);
    }
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    },
  });
}