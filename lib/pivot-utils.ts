// Pivot analysis utilities

export interface HourlyCandle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  hour: number // UTC hour (0-23)
}

export interface DailyPivot {
  date: string
  dayOfWeek: number // 0 = Sunday, 6 = Saturday
  open: number
  high: number
  low: number
  highHour: number // Hour when high occurred
  lowHour: number // Hour when low occurred
  p1Type: 'high' | 'low' // Which came first
  p1Hour: number
  p1Price: number
  p2Type: 'high' | 'low'
  p2Hour: number
  p2Price: number
}

export interface HourlyStats {
  hour: number
  p1Count: number
  p2Count: number
  totalDays: number
  p1Probability: number
  p2Probability: number
  lastP1DaysAgo: number | null
  lastP2DaysAgo: number | null
}

export interface WeeklyPivot {
  weekStart: string // ISO format date of Monday
  weekEnd: string // ISO format date of Sunday
  weekNumber: number
  year: number
  open: number
  high: number
  low: number
  highDay: number // Day of week when high occurred (0-6)
  lowDay: number // Day of week when low occurred (0-6)
  p1Type: 'high' | 'low' // Which came first
  p1Day: number
  p1Price: number
  p2Type: 'high' | 'low'
  p2Day: number
  p2Price: number
}

export interface DailyStats {
  day: number // Day of week (0-6)
  p1Count: number
  p2Count: number
  totalWeeks: number
  p1Probability: number
  p2Probability: number
  lastP1WeeksAgo: number | null
  lastP2WeeksAgo: number | null
}

/**
 * Converts Bybit hourly kline data to our format
 */
export function parseHourlyCandles(bybitData: any[]): HourlyCandle[] {
  return bybitData.map(candle => {
    const timestamp = parseInt(candle[0])
    const date = new Date(timestamp)
    
    return {
      timestamp,
      open: parseFloat(candle[1]),
      high: parseFloat(candle[2]),
      low: parseFloat(candle[3]),
      close: parseFloat(candle[4]),
      hour: date.getUTCHours(),
    }
  })
}

/**
 * Groups hourly candles into daily pivots
 */
export function calculateDailyPivots(hourlyCandles: HourlyCandle[]): DailyPivot[] {
  // Group candles by day
  const dailyGroups = new Map<string, HourlyCandle[]>()
  
  hourlyCandles.forEach(candle => {
    const date = new Date(candle.timestamp)
    const dateKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
    
    if (!dailyGroups.has(dateKey)) {
      dailyGroups.set(dateKey, [])
    }
    dailyGroups.get(dateKey)!.push(candle)
  })
  
  const pivots: DailyPivot[] = []
  
  // Calculate pivots for each day
  dailyGroups.forEach((candles, dateKey) => {
    if (candles.length === 0) return
    
    // Sort by timestamp to ensure chronological order
    candles.sort((a, b) => a.timestamp - b.timestamp)
    
    // First pass: find the actual daily high and low values
    const dailyHigh = Math.max(...candles.map(c => c.high))
    const dailyLow = Math.min(...candles.map(c => c.low))
    
    // Second pass: find WHEN each extreme was first reached (chronologically)
    let firstHighHour = -1
    let firstLowHour = -1
    let firstHighTimestamp = Infinity
    let firstLowTimestamp = Infinity
    
    for (const candle of candles) {
      // Check if this candle contains the daily high (and we haven't found it yet)
      if (firstHighHour === -1 && candle.high >= dailyHigh) {
        firstHighHour = candle.hour
        firstHighTimestamp = candle.timestamp
      }
      
      // Check if this candle contains the daily low (and we haven't found it yet)
      if (firstLowHour === -1 && candle.low <= dailyLow) {
        firstLowHour = candle.hour
        firstLowTimestamp = candle.timestamp
      }
      
      // Exit early if we found both
      if (firstHighHour !== -1 && firstLowHour !== -1) {
        break
      }
    }
    
    // Determine which came first
    let highCameFirst: boolean
    
    if (firstHighTimestamp === firstLowTimestamp) {
      // Both in same hour - use OHLC logic
      const candle = candles.find(c => c.timestamp === firstHighTimestamp)!
      const isBullish = candle.close >= candle.open
      highCameFirst = !isBullish
    } else {
      highCameFirst = firstHighTimestamp < firstLowTimestamp
    }
    
    const date = new Date(candles[0].timestamp)
    
    pivots.push({
      date: dateKey,
      dayOfWeek: date.getUTCDay(),
      open: candles[0].open,
      high: dailyHigh,
      low: dailyLow,
      highHour: firstHighHour,
      lowHour: firstLowHour,
      p1Type: highCameFirst ? 'high' : 'low',
      p1Hour: highCameFirst ? firstHighHour : firstLowHour,
      p1Price: highCameFirst ? dailyHigh : dailyLow,
      p2Type: highCameFirst ? 'low' : 'high',
      p2Hour: highCameFirst ? firstLowHour : firstHighHour,
      p2Price: highCameFirst ? dailyLow : dailyHigh,
    })
  })
  
  return pivots.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Calculate hourly statistics from daily pivots
 */
export function calculateHourlyStats(
  pivots: DailyPivot[],
  weekdayFilter?: number[]
): HourlyStats[] {
  // Filter by weekday if specified
  const filteredPivots = weekdayFilter && weekdayFilter.length > 0
    ? pivots.filter(p => weekdayFilter.includes(p.dayOfWeek))
    : pivots
  
  const totalDays = filteredPivots.length
  
  // Initialize stats for each hour
  const stats: Map<number, {
    p1Count: number
    p2Count: number
    lastP1Date: string | null
    lastP2Date: string | null
  }> = new Map()
  
  for (let hour = 0; hour < 24; hour++) {
    stats.set(hour, {
      p1Count: 0,
      p2Count: 0,
      lastP1Date: null,
      lastP2Date: null,
    })
  }
  
  // Count occurrences
  filteredPivots.forEach(pivot => {
    const hourStats = stats.get(pivot.p1Hour)!
    hourStats.p1Count++
    hourStats.lastP1Date = pivot.date
    
    const p2HourStats = stats.get(pivot.p2Hour)!
    p2HourStats.p2Count++
    p2HourStats.lastP2Date = pivot.date
  })
  
  // Calculate probabilities and days ago
  const latestDate = filteredPivots.length > 0 
    ? filteredPivots[filteredPivots.length - 1].date 
    : new Date().toISOString().split('T')[0]
  
  const result: HourlyStats[] = []
  
  for (let hour = 0; hour < 24; hour++) {
    const hourData = stats.get(hour)!
    
    const lastP1DaysAgo = hourData.lastP1Date 
      ? Math.floor((new Date(latestDate).getTime() - new Date(hourData.lastP1Date).getTime()) / (1000 * 60 * 60 * 24))
      : null
    
    const lastP2DaysAgo = hourData.lastP2Date
      ? Math.floor((new Date(latestDate).getTime() - new Date(hourData.lastP2Date).getTime()) / (1000 * 60 * 60 * 24))
      : null
    
    result.push({
      hour,
      p1Count: hourData.p1Count,
      p2Count: hourData.p2Count,
      totalDays,
      p1Probability: totalDays > 0 ? (hourData.p1Count / totalDays) * 100 : 0,
      p2Probability: totalDays > 0 ? (hourData.p2Count / totalDays) * 100 : 0,
      lastP1DaysAgo,
      lastP2DaysAgo,
    })
  }
  
  return result
}

/**
 * Adjust probabilities for current day by excluding past hours
 */
export function adjustForCurrentDay(
  stats: HourlyStats[],
  currentUTCHour: number
): HourlyStats[] {
  // Only consider future hours
  const futureHours = stats.filter(s => s.hour >= currentUTCHour)
  
  if (futureHours.length === 0) return stats
  
  // Recalculate probabilities based on remaining hours
  const totalP1 = futureHours.reduce((sum, s) => sum + s.p1Count, 0)
  const totalP2 = futureHours.reduce((sum, s) => sum + s.p2Count, 0)
  
  return stats.map(stat => {
    if (stat.hour < currentUTCHour) {
      return {
        ...stat,
        p1Probability: 0,
        p2Probability: 0,
      }
    }
    
    return {
      ...stat,
      p1Probability: totalP1 > 0 ? (stat.p1Count / totalP1) * 100 : 0,
      p2Probability: totalP2 > 0 ? (stat.p2Count / totalP2) * 100 : 0,
    }
  })
}

/**
 * Helper to get Monday of the week for a given date
 */
function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day // Adjust when day is Sunday
  d.setUTCDate(d.getUTCDate() + diff)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/**
 * Helper to get ISO week number
 */
function getISOWeek(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return { week: weekNo, year: d.getUTCFullYear() }
}

/**
 * Groups daily pivots into weekly pivots
 */
export function calculateWeeklyPivots(dailyPivots: DailyPivot[]): WeeklyPivot[] {
  if (dailyPivots.length === 0) return []
  
  // Group daily pivots by week
  const weeklyGroups = new Map<string, DailyPivot[]>()
  
  dailyPivots.forEach(pivot => {
    const date = new Date(pivot.date + 'T00:00:00Z')
    const monday = getMondayOfWeek(date)
    const weekKey = monday.toISOString().split('T')[0]
    
    if (!weeklyGroups.has(weekKey)) {
      weeklyGroups.set(weekKey, [])
    }
    weeklyGroups.get(weekKey)!.push(pivot)
  })
  
  const weeklyPivots: WeeklyPivot[] = []
  
  // Calculate weekly pivots
  weeklyGroups.forEach((pivots, weekStart) => {
    if (pivots.length === 0) return
    
    // Sort by date
    pivots.sort((a, b) => a.date.localeCompare(b.date))
    
    // Find weekly high and low
    const weeklyHigh = Math.max(...pivots.map(p => p.high))
    const weeklyLow = Math.min(...pivots.map(p => p.low))
    
    // Find which day of week had the high and low (first occurrence)
    let highDay = -1
    let lowDay = -1
    let highTimestamp = Infinity
    let lowTimestamp = Infinity
    
    for (const pivot of pivots) {
      const pivotDate = new Date(pivot.date + 'T00:00:00Z')
      const timestamp = pivotDate.getTime()
      
      if (highDay === -1 && pivot.high >= weeklyHigh) {
        highDay = pivot.dayOfWeek
        highTimestamp = timestamp
      }
      
      if (lowDay === -1 && pivot.low <= weeklyLow) {
        lowDay = pivot.dayOfWeek
        lowTimestamp = timestamp
      }
      
      if (highDay !== -1 && lowDay !== -1) break
    }
    
    // Determine P1 and P2
    const highCameFirst = highTimestamp < lowTimestamp
    
    const weekStartDate = new Date(weekStart + 'T00:00:00Z')
    const weekEndDate = new Date(weekStartDate)
    weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6)
    
    const { week, year } = getISOWeek(weekStartDate)
    
    weeklyPivots.push({
      weekStart,
      weekEnd: weekEndDate.toISOString().split('T')[0],
      weekNumber: week,
      year,
      open: pivots[0].open,
      high: weeklyHigh,
      low: weeklyLow,
      highDay,
      lowDay,
      p1Type: highCameFirst ? 'high' : 'low',
      p1Day: highCameFirst ? highDay : lowDay,
      p1Price: highCameFirst ? weeklyHigh : weeklyLow,
      p2Type: highCameFirst ? 'low' : 'high',
      p2Day: highCameFirst ? lowDay : highDay,
      p2Price: highCameFirst ? weeklyLow : weeklyHigh,
    })
  })
  
  return weeklyPivots.sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

/**
 * Calculate daily statistics from weekly pivots (similar to calculateHourlyStats but for days)
 */
export function calculateDailyStats(
  weeklyPivots: WeeklyPivot[]
): DailyStats[] {
  const totalWeeks = weeklyPivots.length
  
  // Initialize stats for each day of week (0 = Sunday, 6 = Saturday)
  const stats: Map<number, {
    p1Count: number
    p2Count: number
    lastP1Week: string | null
    lastP2Week: string | null
  }> = new Map()
  
  for (let day = 0; day < 7; day++) {
    stats.set(day, {
      p1Count: 0,
      p2Count: 0,
      lastP1Week: null,
      lastP2Week: null,
    })
  }
  
  // Count occurrences
  weeklyPivots.forEach(pivot => {
    const dayStats = stats.get(pivot.p1Day)!
    dayStats.p1Count++
    dayStats.lastP1Week = pivot.weekStart
    
    const p2DayStats = stats.get(pivot.p2Day)!
    p2DayStats.p2Count++
    p2DayStats.lastP2Week = pivot.weekStart
  })
  
  // Calculate probabilities and weeks ago
  const latestWeek = weeklyPivots.length > 0
    ? weeklyPivots[weeklyPivots.length - 1].weekStart
    : new Date().toISOString().split('T')[0]
  
  const result: DailyStats[] = []
  
  for (let day = 0; day < 7; day++) {
    const dayData = stats.get(day)!
    
    const lastP1WeeksAgo = dayData.lastP1Week
      ? Math.floor((new Date(latestWeek).getTime() - new Date(dayData.lastP1Week).getTime()) / (1000 * 60 * 60 * 24 * 7))
      : null
    
    const lastP2WeeksAgo = dayData.lastP2Week
      ? Math.floor((new Date(latestWeek).getTime() - new Date(dayData.lastP2Week).getTime()) / (1000 * 60 * 60 * 24 * 7))
      : null
    
    result.push({
      day,
      p1Count: dayData.p1Count,
      p2Count: dayData.p2Count,
      totalWeeks,
      p1Probability: totalWeeks > 0 ? (dayData.p1Count / totalWeeks) * 100 : 0,
      p2Probability: totalWeeks > 0 ? (dayData.p2Count / totalWeeks) * 100 : 0,
      lastP1WeeksAgo,
      lastP2WeeksAgo,
    })
  }
  
  return result
}

export type HeatmapScheme = 'green' | 'viridis' | 'plasma' | 'inferno' | 'turbo' | 'blues'

/**
 * Viridis color scheme
 */
const viridisColors = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 73, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [110, 206, 88],
  [181, 222, 43],
  [253, 231, 37]
]

/**
 * Plasma color scheme
 */
const plasmaColors = [
  [13, 8, 135],
  [75, 3, 161],
  [125, 3, 168],
  [168, 34, 150],
  [203, 70, 121],
  [229, 107, 93],
  [248, 148, 65],
  [253, 195, 40],
  [250, 239, 85],
  [240, 249, 33]
]

/**
 * Inferno color scheme
 */
const infernoColors = [
  [0, 0, 4],
  [40, 11, 84],
  [101, 21, 110],
  [159, 42, 99],
  [212, 72, 66],
  [245, 108, 39],
  [252, 153, 21],
  [248, 201, 37],
  [240, 240, 110],
  [252, 255, 164]
]

/**
 * Turbo color scheme
 */
const turboColors = [
  [48, 18, 59],
  [62, 73, 137],
  [33, 145, 140],
  [53, 183, 121],
  [159, 218, 58],
  [253, 231, 37],
  [254, 178, 35],
  [240, 92, 42],
  [189, 21, 47],
  [122, 4, 3]
]

/**
 * Blues color scheme
 */
const bluesColors = [
  [247, 251, 255],
  [222, 235, 247],
  [198, 219, 239],
  [158, 202, 225],
  [107, 174, 214],
  [66, 146, 198],
  [33, 113, 181],
  [8, 81, 156],
  [8, 48, 107],
  [3, 19, 43]
]

/**
 * Interpolate between colors in a palette
 */
function interpolateColor(palette: number[][], value: number): [number, number, number] {
  const idx = value * (palette.length - 1)
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  const t = idx - lower
  
  if (lower === upper) {
    return palette[lower] as [number, number, number]
  }
  
  const lowerColor = palette[lower]
  const upperColor = palette[upper]
  
  return [
    Math.round(lowerColor[0] + (upperColor[0] - lowerColor[0]) * t),
    Math.round(lowerColor[1] + (upperColor[1] - lowerColor[1]) * t),
    Math.round(lowerColor[2] + (upperColor[2] - lowerColor[2]) * t)
  ]
}

/**
 * Get color for heatmap based on probability and scheme
 */
export function getHeatmapColor(
  probability: number,
  isDark: boolean,
  scheme: HeatmapScheme = 'green',
  intensityMultiplier: number = 1.0
): string {
  if (probability === 0) return isDark ? 'rgb(30, 30, 30)' : 'rgb(250, 250, 250)'
  
  // Apply intensity multiplier to make colors more/less saturated
  let intensity = Math.min(100, probability) / 100
  intensity = Math.pow(intensity, 1 / intensityMultiplier) // Higher multiplier = more intense colors
  
  // Default green scheme (original)
  if (scheme === 'green') {
    if (isDark) {
      const r = Math.floor(15 + (intensity * 40))
      const g = Math.floor(40 + (intensity * 120))
      const b = Math.floor(15 + (intensity * 40))
      return `rgb(${r}, ${g}, ${b})`
    } else {
      const r = Math.floor(200 - (intensity * 150))
      const g = Math.floor(220 - (intensity * 50))
      const b = Math.floor(255 - (intensity * 100))
      return `rgb(${r}, ${g}, ${b})`
    }
  }
  
  // Scientific color schemes
  let palette: number[][]
  switch (scheme) {
    case 'viridis':
      palette = viridisColors
      break
    case 'plasma':
      palette = plasmaColors
      break
    case 'inferno':
      palette = infernoColors
      break
    case 'turbo':
      palette = turboColors
      break
    case 'blues':
      palette = bluesColors
      break
    default:
      palette = viridisColors
  }
  
  const [r, g, b] = interpolateColor(palette, intensity)
  return `rgb(${r}, ${g}, ${b})`
}

/**
 * Get text color based on background brightness
 */
export function getTextColor(bgColor: string): string {
  const match = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (!match) return 'inherit'
  
  const r = parseInt(match[1])
  const g = parseInt(match[2])
  const b = parseInt(match[3])
  
  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  
  return luminance > 0.5 ? '#000000' : '#ffffff'
}

