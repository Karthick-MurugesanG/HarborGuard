import React from 'react'
import { Button } from './button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'
import { IconChevronLeft, IconChevronRight, IconChevronsLeft, IconChevronsRight } from '@tabler/icons-react'

interface PaginationProps {
  currentPage: number
  totalItems: number
  itemsPerPage: number
  onPageChange: (page: number) => void
  onItemsPerPageChange: (itemsPerPage: number) => void
  showTotal?: boolean
  pageSizeOptions?: number[]
  className?: string
}

export function Pagination({
  currentPage,
  totalItems,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange,
  showTotal = true,
  pageSizeOptions = [10, 20, 50, 100],
  className = ""
}: PaginationProps) {
  const totalPages = Math.ceil(totalItems / itemsPerPage)
  const startItem = (currentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(currentPage * itemsPerPage, totalItems)

  const canGoToPrevious = currentPage > 1
  const canGoToNext = currentPage < totalPages

  const getVisiblePages = () => {
    const delta = 2
    const range = []
    const rangeWithDots = []

    for (let i = Math.max(2, currentPage - delta); 
         i <= Math.min(totalPages - 1, currentPage + delta); 
         i++) {
      range.push(i)
    }

    if (currentPage - delta > 2) {
      rangeWithDots.push(1, '...')
    } else {
      rangeWithDots.push(1)
    }

    rangeWithDots.push(...range)

    if (currentPage + delta < totalPages - 1) {
      rangeWithDots.push('...', totalPages)
    } else if (totalPages > 1) {
      rangeWithDots.push(totalPages)
    }

    return rangeWithDots
  }

  if (totalItems === 0) {
    return null
  }

  return (
    <div className={`flex items-center justify-between space-x-2 ${className}`}>
      {/* Items per page selector */}
      <div className="flex items-center space-x-2">
        <span className="text-sm text-muted-foreground">Show</span>
        <Select
          value={itemsPerPage.toString()}
          onValueChange={(value) => onItemsPerPageChange(Number(value))}
        >
          <SelectTrigger className="w-16 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((size) => (
              <SelectItem key={size} value={size.toString()}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">per page</span>
      </div>

      {/* Page info */}
      {showTotal && (
        <div className="text-sm text-muted-foreground">
          Showing {startItem} to {endItem} of {totalItems} entries
        </div>
      )}

      {/* Pagination controls */}
      <div className="flex items-center space-x-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(1)}
          disabled={!canGoToPrevious}
          className="h-8 w-8 p-0"
        >
          <IconChevronsLeft className="h-4 w-4" />
        </Button>
        
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={!canGoToPrevious}
          className="h-8 w-8 p-0"
        >
          <IconChevronLeft className="h-4 w-4" />
        </Button>

        {getVisiblePages().map((page, index) => (
          page === '...' ? (
            <span key={index} className="px-2 text-muted-foreground">
              ...
            </span>
          ) : (
            <Button
              key={index}
              variant={page === currentPage ? "default" : "outline"}
              size="sm"
              onClick={() => onPageChange(page as number)}
              className="h-8 w-8 p-0"
            >
              {page}
            </Button>
          )
        ))}

        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={!canGoToNext}
          className="h-8 w-8 p-0"
        >
          <IconChevronRight className="h-4 w-4" />
        </Button>
        
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(totalPages)}
          disabled={!canGoToNext}
          className="h-8 w-8 p-0"
        >
          <IconChevronsRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}