'use client'

import { useEffect, useRef } from 'react'
import { createChart, ColorType, IChartApi, ISeriesApi, LineData } from 'lightweight-charts'

interface FlowBucket {
  timestamp: number
  netPositionFlow: number
  aggressiveRatio: number
}

interface PositionFlowChartProps {
  data: FlowBucket[]
  height?: number
}

export function PositionFlowChart({ data, height = 400 }: PositionFlowChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null)

  useEffect(() => {
    if (!chartContainerRef.current) return

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgb(156, 163, 175)',
      },
      width: chartContainerRef.current.clientWidth,
      height,
      grid: {
        vertLines: { color: 'rgba(156, 163, 175, 0.1)' },
        horzLines: { color: 'rgba(156, 163, 175, 0.1)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(156, 163, 175, 0.2)',
      },
      timeScale: {
        borderColor: 'rgba(156, 163, 175, 0.2)',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: {
          color: 'rgba(156, 163, 175, 0.5)',
          width: 1,
          style: 1,
        },
        horzLine: {
          color: 'rgba(156, 163, 175, 0.5)',
          width: 1,
          style: 1,
        },
      },
    })

    chartRef.current = chart

    // Create area series for net position flow
    const series = chart.addAreaSeries({
      lineColor: 'rgb(34, 197, 94)', // green-500
      topColor: 'rgba(34, 197, 94, 0.3)',
      bottomColor: 'rgba(239, 68, 68, 0.3)', // red-500 when negative
      lineWidth: 2,
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => {
          if (Math.abs(price) >= 1000000) {
            return `$${(price / 1000000).toFixed(2)}M`
          } else if (Math.abs(price) >= 1000) {
            return `$${(price / 1000).toFixed(0)}K`
          }
          return `$${price.toFixed(0)}`
        },
      },
    })

    seriesRef.current = series

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        })
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }
    }
  }, [height])

  // Update data
  useEffect(() => {
    if (!seriesRef.current || !data || data.length === 0) return

    // Convert to chart format
    const chartData: LineData[] = data
      .map((bucket) => ({
        time: (bucket.timestamp / 1000) as any, // Convert to seconds
        value: bucket.netPositionFlow,
      }))
      .sort((a, b) => a.time - b.time)

    if (chartData.length > 0) {
      seriesRef.current.setData(chartData)
      
      // Fit content
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent()
      }
    }
  }, [data])

  return (
    <div className="relative w-full">
      <div className="absolute top-0 left-0 z-10 p-4">
        <div className="text-sm font-medium text-muted-foreground">
          Net Position Flow
        </div>
        <div className="text-xs text-muted-foreground">
          (Long Opens - Long Closes) - (Short Opens - Short Closes)
        </div>
      </div>
      <div ref={chartContainerRef} className="w-full" />
    </div>
  )
}

