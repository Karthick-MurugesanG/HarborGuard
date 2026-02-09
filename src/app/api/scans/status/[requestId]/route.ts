import { NextRequest, NextResponse } from 'next/server'
import { scannerService } from '@/lib/scanner'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params
    
    // Get job status from scanner service
    const job = scannerService.getScanJob(requestId)
    
    if (!job) {
      return NextResponse.json(
        { error: 'Scan job not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({
      requestId: job.requestId,
      scanId: job.scanId,
      imageId: job.imageId,
      status: job.status,
      progress: job.progress,
      error: job.error
    })
    
  } catch (error) {
    console.error('Error getting scan status:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}