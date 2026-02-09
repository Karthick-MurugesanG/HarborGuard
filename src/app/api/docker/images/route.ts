import { NextResponse } from 'next/server';
import { listDockerImages } from '@/lib/docker';

export async function GET() {
  try {
    const images = await listDockerImages();
    return NextResponse.json(images);
  } catch (error) {
    console.error('Failed to list Docker images:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list Docker images' },
      { status: 500 }
    );
  }
}