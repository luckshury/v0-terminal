/*
 * Global App State Provider
 * 
 * This context provides persistent state across page navigation:
 * 
 * 1. Live Prices (REST API Polling):
 *    - Fetches ticker data via REST API at regular intervals
 *    - No WebSocket connections
 *    - Stays active during page navigation
 * 
 * 2. Screener Settings:
 *    - Persisted to localStorage
 *    - Restored on app reload
 *    - Includes filters, sort order, view modes
 * 
 * Benefits:
 *    - Simple architecture (no WebSocket management)
 *    - State preservation (no lost filters)
 *    - Lower server load (controlled polling rate)
 */

'use client'

import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo, ReactNode } from 'react'

export interface TickerPrice {
  symbol: string
  price: number
  midPx: string
  markPx: string
  oraclePx: string
  change?: number
  previousPrice?: number
}

export interface Watchlist {
  id: string
  name: string
  symbols: string[]
  createdAt: number
}

interface ScreenerSettings {
  sortBy: string
  range: string
  searchQuery: string
  chartDataFilter: 'all' | 'coingecko'
  hybridMode: boolean
  simpleMode: boolean
  crazyMode: boolean
  tableSortColumn: 'symbol' | 'price' | 'change' | 'percent'
  tableSortDirection: 'asc' | 'desc'
  exchange: 'hyperliquid' | 'bybit' | 'binance'
  showScrollingBanner: boolean
  selectedWatchlistId: string | null
}

interface AllFillsSettings {
  limit: number
  sideFilter: 'all' | 'A' | 'B'
  searchQuery: string
}

interface L4OrdersSettings {
  selectedCoin: string
  sortColumn: 'triggerPrice' | 'size' | 'side' | null
  sortDirection: 'asc' | 'desc'
  displayLimit: number
}

interface PivotAnalysisSettings {
  ticker: string
  selectedWeekdays: number[]
  heatmapScheme: 'viridis' | 'plasma' | 'inferno' | 'turbo' | 'blues' | 'green'
  intensity: number
  daysBack: number
}

interface AppStateContextValue {
  // Live prices
  tickers: Record<string, TickerPrice>
  isConnected: boolean
  tickerList: TickerPrice[]
  
  // Screener settings
  screenerSettings: ScreenerSettings
  updateScreenerSettings: (settings: Partial<ScreenerSettings>) => void
  
  // All-fills settings
  allFillsSettings: AllFillsSettings
  updateAllFillsSettings: (settings: Partial<AllFillsSettings>) => void
  
  // L4 Orders settings
  l4OrdersSettings: L4OrdersSettings
  updateL4OrdersSettings: (settings: Partial<L4OrdersSettings>) => void
  
  // Pivot Analysis settings
  pivotAnalysisSettings: PivotAnalysisSettings
  updatePivotAnalysisSettings: (settings: Partial<PivotAnalysisSettings>) => void
  
  // Font settings
  fontTheme: 'default' | 'alpina'
  toggleFontTheme: () => void

  // Watchlists
  watchlists: Watchlist[]
  createWatchlist: (name: string, symbols?: string[]) => string
  updateWatchlist: (id: string, updates: Partial<Omit<Watchlist, 'id' | 'createdAt'>>) => void
  deleteWatchlist: (id: string) => void
  addSymbolToWatchlist: (watchlistId: string, symbol: string) => void
  removeSymbolFromWatchlist: (watchlistId: string, symbol: string) => void
}

const AppStateContext = createContext<AppStateContextValue | undefined>(undefined)

const DEFAULT_SCREENER_SETTINGS: ScreenerSettings = {
  sortBy: 'symbol',
  range: '1d',
  searchQuery: '',
  chartDataFilter: 'all',
  hybridMode: false,
  simpleMode: false,
  crazyMode: false,
  tableSortColumn: 'percent',
  tableSortDirection: 'desc',
  exchange: 'hyperliquid',
  showScrollingBanner: true,
  selectedWatchlistId: null,
}

const DEFAULT_ALL_FILLS_SETTINGS: AllFillsSettings = {
  limit: 200,
  sideFilter: 'all',
  searchQuery: '',
}

const DEFAULT_L4_ORDERS_SETTINGS: L4OrdersSettings = {
  selectedCoin: 'BTC',
  sortColumn: null,
  sortDirection: 'desc',
  displayLimit: 100,
}

const DEFAULT_PIVOT_ANALYSIS_SETTINGS: PivotAnalysisSettings = {
  ticker: 'BTCUSDT',
  selectedWeekdays: [],
  heatmapScheme: 'viridis',
  intensity: 1.0,
  daysBack: 90,
}

// Load settings from localStorage
const loadScreenerSettings = (): ScreenerSettings => {
  if (typeof window === 'undefined') return DEFAULT_SCREENER_SETTINGS
  
  try {
    const saved = localStorage.getItem('screener-settings')
    if (saved) {
      return { ...DEFAULT_SCREENER_SETTINGS, ...JSON.parse(saved) }
    }
  } catch (error) {
    console.error('Failed to load screener settings:', error)
  }
  
  return DEFAULT_SCREENER_SETTINGS
}

const loadAllFillsSettings = (): AllFillsSettings => {
  if (typeof window === 'undefined') return DEFAULT_ALL_FILLS_SETTINGS
  
  try {
    const saved = localStorage.getItem('all-fills-settings')
    if (saved) {
      return { ...DEFAULT_ALL_FILLS_SETTINGS, ...JSON.parse(saved) }
    }
  } catch (error) {
    console.error('Failed to load all-fills settings:', error)
  }
  
  return DEFAULT_ALL_FILLS_SETTINGS
}

const loadL4OrdersSettings = (): L4OrdersSettings => {
  if (typeof window === 'undefined') return DEFAULT_L4_ORDERS_SETTINGS
  
  try {
    const saved = localStorage.getItem('l4-orders-settings')
    if (saved) {
      return { ...DEFAULT_L4_ORDERS_SETTINGS, ...JSON.parse(saved) }
    }
  } catch (error) {
    console.error('Failed to load l4-orders settings:', error)
  }
  
  return DEFAULT_L4_ORDERS_SETTINGS
}

const loadPivotAnalysisSettings = (): PivotAnalysisSettings => {
  if (typeof window === 'undefined') return DEFAULT_PIVOT_ANALYSIS_SETTINGS
  
  try {
    const saved = localStorage.getItem('pivot-analysis-settings')
    if (saved) {
      return { ...DEFAULT_PIVOT_ANALYSIS_SETTINGS, ...JSON.parse(saved) }
    }
  } catch (error) {
    console.error('Failed to load pivot-analysis settings:', error)
  }
  
  return DEFAULT_PIVOT_ANALYSIS_SETTINGS
}

const loadWatchlists = (): Watchlist[] => {
  if (typeof window === 'undefined') return []
  
  try {
    const saved = localStorage.getItem('watchlists')
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (error) {
    console.error('Failed to load watchlists:', error)
  }
  
  return []
}

// Save settings to localStorage
const saveScreenerSettings = (settings: ScreenerSettings) => {
  if (typeof window === 'undefined') return
  
  try {
    localStorage.setItem('screener-settings', JSON.stringify(settings))
  } catch (error) {
    console.error('Failed to save screener settings:', error)
  }
}

const saveAllFillsSettings = (settings: AllFillsSettings) => {
  if (typeof window === 'undefined') return
  
  try {
    localStorage.setItem('all-fills-settings', JSON.stringify(settings))
  } catch (error) {
    console.error('Failed to save all-fills settings:', error)
  }
}

const saveL4OrdersSettings = (settings: L4OrdersSettings) => {
  if (typeof window === 'undefined') return
  
  try {
    localStorage.setItem('l4-orders-settings', JSON.stringify(settings))
  } catch (error) {
    console.error('Failed to save l4-orders settings:', error)
  }
}

const savePivotAnalysisSettings = (settings: PivotAnalysisSettings) => {
  if (typeof window === 'undefined') return
  
  try {
    localStorage.setItem('pivot-analysis-settings', JSON.stringify(settings))
  } catch (error) {
    console.error('Failed to save pivot-analysis settings:', error)
  }
}

const saveWatchlists = (watchlists: Watchlist[]) => {
  if (typeof window === 'undefined') return
  
  try {
    localStorage.setItem('watchlists', JSON.stringify(watchlists))
  } catch (error) {
    console.error('Failed to save watchlists:', error)
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  // Live prices state (REST API polling)
  const [tickers, setTickers] = useState<Record<string, TickerPrice>>({})
  const [isConnected, setIsConnected] = useState(false)
  const previousPricesRef = useRef<Record<string, number>>({})
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  
  // Screener settings (persistent across navigation)
  const [screenerSettings, setScreenerSettings] = useState<ScreenerSettings>(DEFAULT_SCREENER_SETTINGS)
  
  // All-fills settings (persistent across navigation)
  const [allFillsSettings, setAllFillsSettings] = useState<AllFillsSettings>(DEFAULT_ALL_FILLS_SETTINGS)
  
  // L4 Orders settings (persistent across navigation)
  const [l4OrdersSettings, setL4OrdersSettings] = useState<L4OrdersSettings>(DEFAULT_L4_ORDERS_SETTINGS)
  
  // Pivot Analysis settings (persistent across navigation)
  const [pivotAnalysisSettings, setPivotAnalysisSettings] = useState<PivotAnalysisSettings>(DEFAULT_PIVOT_ANALYSIS_SETTINGS)
  
  // Watchlists (persistent across navigation)
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])

  // Font theme state - initialize from DOM to match blocking script
  const [fontTheme, setFontTheme] = useState<'default' | 'alpina'>(() => {
    if (typeof window === 'undefined') return 'default'
    const domFont = document.documentElement.getAttribute('data-font')
    return domFont === 'alpina' ? 'alpina' : 'default'
  })

  // Load persisted settings on mount
  useEffect(() => {
    setScreenerSettings(loadScreenerSettings())
    setAllFillsSettings(loadAllFillsSettings())
    setL4OrdersSettings(loadL4OrdersSettings())
    setPivotAnalysisSettings(loadPivotAnalysisSettings())
    setWatchlists(loadWatchlists())
    
    // Sync font theme from DOM (already set by blocking script)
    const domFont = document.documentElement.getAttribute('data-font')
    if (domFont === 'alpina' || domFont === 'default') {
      setFontTheme(domFont)
    }
  }, [])

  const toggleFontTheme = useCallback(() => {
    setFontTheme(prev => {
      const next = prev === 'default' ? 'alpina' : 'default'
      localStorage.setItem('font-theme', next)
      return next
    })
  }, [])

  // Apply font theme
  useEffect(() => {
    const root = document.documentElement
    if (fontTheme === 'alpina') {
      root.setAttribute('data-font', 'alpina')
    } else {
      root.setAttribute('data-font', 'default')
    }
  }, [fontTheme])
  
  // Update screener settings and persist
  const updateScreenerSettings = useCallback((settings: Partial<ScreenerSettings>) => {
    setScreenerSettings(prev => {
      const updated = { ...prev, ...settings }
      saveScreenerSettings(updated)
      return updated
    })
  }, [])
  
  // Update all-fills settings and persist
  const updateAllFillsSettings = useCallback((settings: Partial<AllFillsSettings>) => {
    setAllFillsSettings(prev => {
      const updated = { ...prev, ...settings }
      saveAllFillsSettings(updated)
      return updated
    })
  }, [])
  
  // Update L4 Orders settings and persist
  const updateL4OrdersSettings = useCallback((settings: Partial<L4OrdersSettings>) => {
    setL4OrdersSettings(prev => {
      const updated = { ...prev, ...settings }
      saveL4OrdersSettings(updated)
      return updated
    })
  }, [])
  
  // Update Pivot Analysis settings and persist
  const updatePivotAnalysisSettings = useCallback((settings: Partial<PivotAnalysisSettings>) => {
    setPivotAnalysisSettings(prev => {
      const updated = { ...prev, ...settings }
      savePivotAnalysisSettings(updated)
      return updated
    })
  }, [])
  
  // Create watchlist
  const createWatchlist = useCallback((name: string, symbols: string[] = []): string => {
    const newWatchlist: Watchlist = {
      id: `wl_${Date.now()}`,
      name,
      symbols,
      createdAt: Date.now(),
    }
    
    setWatchlists(prev => {
      const updated = [...prev, newWatchlist]
      saveWatchlists(updated)
      return updated
    })
    
    return newWatchlist.id
  }, [])
  
  // Update watchlist
  const updateWatchlist = useCallback((id: string, updates: Partial<Omit<Watchlist, 'id' | 'createdAt'>>) => {
    setWatchlists(prev => {
      const updated = prev.map(wl => 
        wl.id === id ? { ...wl, ...updates } : wl
      )
      saveWatchlists(updated)
      return updated
    })
  }, [])
  
  // Delete watchlist
  const deleteWatchlist = useCallback((id: string) => {
    setWatchlists(prev => {
      const updated = prev.filter(wl => wl.id !== id)
      saveWatchlists(updated)
      return updated
    })
    
    // If the deleted watchlist was selected, clear selection
    if (screenerSettings.selectedWatchlistId === id) {
      updateScreenerSettings({ selectedWatchlistId: null })
    }
  }, [screenerSettings.selectedWatchlistId, updateScreenerSettings])
  
  // Add symbol to watchlist
  const addSymbolToWatchlist = useCallback((watchlistId: string, symbol: string) => {
    setWatchlists(prev => {
      const updated = prev.map(wl => {
        if (wl.id === watchlistId && !wl.symbols.includes(symbol)) {
          return { ...wl, symbols: [...wl.symbols, symbol] }
        }
        return wl
      })
      saveWatchlists(updated)
      return updated
    })
  }, [])
  
  // Remove symbol from watchlist
  const removeSymbolFromWatchlist = useCallback((watchlistId: string, symbol: string) => {
    setWatchlists(prev => {
      const updated = prev.map(wl => {
        if (wl.id === watchlistId) {
          return { ...wl, symbols: wl.symbols.filter(s => s !== symbol) }
        }
        return wl
      })
      saveWatchlists(updated)
      return updated
    })
  }, [])

  // Fetch all Hyperliquid tickers via REST API
  const fetchAllHyperliquidTickers = useCallback(async () => {
    try {
      const response = await fetch('/api/tickers')
      if (!response.ok) {
        throw new Error(`Failed to fetch tickers: ${response.status}`)
      }

      const data = await response.json()
      const tickersMap: Record<string, TickerPrice> = {}
      
      Object.keys(data).forEach((symbol) => {
        const price = parseFloat(data[symbol])
        if (!isNaN(price)) {
          // Use previous price as baseline if available, otherwise use current price
          const previousPrice = previousPricesRef.current[symbol] || price
          const change = previousPrice !== 0 
            ? ((price - previousPrice) / previousPrice) * 100 
            : 0

          tickersMap[symbol] = {
            symbol,
            price,
            midPx: data[symbol],
            markPx: data[symbol],
            oraclePx: data[symbol],
            previousPrice,
            change,
          }
          
          // Initialize previous price on first fetch
          if (!previousPricesRef.current[symbol]) {
            previousPricesRef.current[symbol] = price
          }
        }
      })

      console.log(`✅ Fetched ${Object.keys(tickersMap).length} Hyperliquid tickers via REST API`)
      setTickers(tickersMap)
      setIsConnected(true)
      return Object.keys(tickersMap)
    } catch (error) {
      console.error('Error fetching Hyperliquid tickers:', error)
      setIsConnected(false)
      return []
    }
  }, [])

  // Fetch all Bybit linear (USDT perpetual) tickers via REST API
  const fetchAllBybitTickers = useCallback(async () => {
    try {
      // First get the list of symbols
      const symbolsResponse = await fetch('/api/bybit-tickers')
      if (!symbolsResponse.ok) {
        throw new Error(`Failed to fetch Bybit tickers: ${symbolsResponse.status}`)
      }

      const symbolsData = await symbolsResponse.json()
      const symbols = symbolsData.tickers || []

      if (symbols.length === 0) {
        console.error('❌ No Bybit tickers found')
        setIsConnected(false)
        return []
      }

      // Fetch price data for all symbols in batches
      const BATCH_SIZE = 25
      const tickersMap: Record<string, TickerPrice> = {}
      
      for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
        const batch = symbols.slice(i, i + BATCH_SIZE)
        
        try {
          const params = new URLSearchParams({
            symbols: batch.join(','),
            range: '1d',
            category: 'linear',
          })
          
          const response = await fetch(`/api/bybit-intraday?${params.toString()}`)
          
          if (response.ok) {
            const data = await response.json()
            
            batch.forEach((symbol: string) => {
              const tickerData = data[symbol]
              if (tickerData && tickerData.lastPrice) {
                const price = parseFloat(tickerData.lastPrice)
                if (!isNaN(price)) {
                  const previousPrice = previousPricesRef.current[symbol] || price
                  const change = previousPrice !== 0 
                    ? ((price - previousPrice) / previousPrice) * 100 
                    : 0

                  tickersMap[symbol] = {
                    symbol,
                    price,
                    midPx: price.toString(),
                    markPx: price.toString(),
                    oraclePx: price.toString(),
                    previousPrice,
                    change,
                  }
                  
                  if (!previousPricesRef.current[symbol]) {
                    previousPricesRef.current[symbol] = price
                  }
                }
              }
            })
          }
        } catch (error) {
          console.error(`Error fetching Bybit batch ${i / BATCH_SIZE + 1}:`, error)
        }
        
        // Small delay between batches
        if (i + BATCH_SIZE < symbols.length) {
          await new Promise(resolve => setTimeout(resolve, 150))
        }
      }

      console.log(`✅ Fetched ${Object.keys(tickersMap).length} Bybit tickers via REST API`)
      setTickers(tickersMap)
      setIsConnected(true)
      return Object.keys(tickersMap)
    } catch (error) {
      console.error('Error fetching Bybit tickers:', error)
      setIsConnected(false)
      return []
    }
  }, [])

  // REST API polling disabled - no automatic fetching
  // To re-enable, uncomment the polling logic below
  /*
  useEffect(() => {
    let mounted = true

    const fetchTickers = async () => {
      if (!mounted) return

      if (screenerSettings.exchange === 'bybit') {
        await fetchAllBybitTickers()
      } else if (screenerSettings.exchange === 'hyperliquid') {
        await fetchAllHyperliquidTickers()
      }
    }

    // Initial fetch
    fetchTickers()

    // Set up polling interval (5 seconds)
    pollingIntervalRef.current = setInterval(() => {
      fetchTickers()
    }, 5000)

    return () => {
      mounted = false
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
    }
  }, [fetchAllHyperliquidTickers, fetchAllBybitTickers, screenerSettings.exchange])
  */

  const tickerList = useMemo(() => Object.values(tickers), [tickers])

  const value: AppStateContextValue = {
    tickers,
    isConnected,
    tickerList,
    screenerSettings,
    updateScreenerSettings,
    allFillsSettings,
    updateAllFillsSettings,
    l4OrdersSettings,
    updateL4OrdersSettings,
    pivotAnalysisSettings,
    updatePivotAnalysisSettings,
    fontTheme,
    toggleFontTheme,
    watchlists,
    createWatchlist,
    updateWatchlist,
    deleteWatchlist,
    addSymbolToWatchlist,
    removeSymbolFromWatchlist,
  }

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  )
}

export function useAppState() {
  const context = useContext(AppStateContext)
  if (context === undefined) {
    throw new Error('useAppState must be used within AppStateProvider')
  }
  return context
}
