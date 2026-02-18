'use client'

import { useState, useEffect, memo } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, GitBranch, Moon, Sun, ScrollText, Type, Activity, TrendingUp, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppState } from '@/contexts/app-state-context'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface NavItem {
  icon: React.ElementType
  label: string
  command: string
  href: string
  badge?: string
}

const navItems: NavItem[] = [
  { icon: Activity, label: 'Screener', command: 'screener', href: '/screener' },
  { icon: Globe, label: 'Landscape', command: 'landscape', href: '/landscape' },
  { icon: TrendingUp, label: 'Positioning', command: 'positioning', href: '/positioning' },
  { icon: GitBranch, label: 'Pivot Analysis', command: 'pivot', href: '/pivot-analysis' },
]

const accentColors = [
  { name: 'green', value: 'oklch(0.75 0.2 142)', label: 'GRN' },
  { name: 'blue', value: 'oklch(0.65 0.22 250)', label: 'BLU' },
  { name: 'orange', value: 'oklch(0.70 0.20 50)', label: 'ORG' },
  { name: 'yellow', value: 'oklch(0.80 0.18 95)', label: 'YLW' },
  { name: 'purple', value: 'oklch(0.65 0.25 290)', label: 'PRP' },
  { name: 'pink', value: 'oklch(0.70 0.22 350)', label: 'PNK' },
]

const themes = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
]

export const CollapsibleSidebar = memo(function CollapsibleSidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)
  const pathname = usePathname()
  
  // Initialize from DOM state
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light'
    return document.documentElement.getAttribute('data-theme') || 'light'
  })
  
  const [accentColor, setAccentColor] = useState(() => {
    if (typeof window === 'undefined') return 'green'
    return localStorage.getItem('accentColor') || 'green'
  })
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false)
  const { screenerSettings, updateScreenerSettings, fontTheme, toggleFontTheme } = useAppState()

  // Track mount state to avoid hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light'
    setTheme(currentTheme)
    
    const savedAccent = localStorage.getItem('accentColor')
    if (savedAccent) {
      setAccentColor(savedAccent)
    }
  }, [])

  const applyAccentColor = (colorName: string) => {
    const color = accentColors.find(c => c.name === colorName)
    if (color) {
      document.documentElement.style.setProperty('--sidebar-primary', color.value)
      document.documentElement.style.setProperty('--primary', color.value)
      document.documentElement.style.setProperty('--accent', color.value)
      document.documentElement.style.setProperty('--ring', color.value)
      document.documentElement.style.setProperty('--sidebar-ring', color.value)
    }
  }

  const changeTheme = (newTheme: string) => {
    setTheme(newTheme)
    document.documentElement.setAttribute('data-theme', newTheme)
    localStorage.setItem('theme', newTheme)
    
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }

  const changeAccentColor = (colorName: string) => {
    setAccentColor(colorName)
    applyAccentColor(colorName)
    localStorage.setItem('accentColor', colorName)
    setIsColorPickerOpen(false)
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (isColorPickerOpen && !target.closest('.color-picker-container')) {
        setIsColorPickerOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isColorPickerOpen])

  // Use Sun as default for SSR, then actual theme icon after mount
  const CurrentThemeIcon = mounted ? (themes.find(t => t.id === theme)?.icon || Sun) : Sun

  return (
    <aside
      className={cn(
        'relative h-screen bg-sidebar border-r-2 border-sidebar-border transition-all duration-200 flex flex-col',
        isCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Header */}
      <div className="p-4 border-b-2 border-sidebar-border">
        <div className="flex items-center justify-between">
          {!isCollapsed && (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-sidebar-muted-foreground">$</span>
              <h1 className="font-mono font-bold text-sm text-sidebar-foreground tracking-tight">
                v0_terminal
              </h1>
            </div>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={cn(
              'p-1.5 border border-sidebar-border hover:bg-sidebar-accent transition-colors',
              isCollapsed && 'mx-auto'
            )}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeft className={cn(
              'h-4 w-4 text-sidebar-muted-foreground transition-transform',
              isCollapsed && 'rotate-180'
            )} />
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 overflow-y-auto">
        <ul className="space-y-0.5 px-2">
          {navItems.map((item, index) => {
            const Icon = item.icon
            const isActive = pathname === item.href || (pathname === '/' && item.href === '/pivot-analysis')

            return (
              <li key={index}>
                <Link
                  href={item.href}
                  prefetch={true}
                  scroll={false}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 border-l-2 transition-none font-mono text-xs',
                    isActive
                      ? 'border-sidebar-primary bg-sidebar-accent text-sidebar-foreground font-bold'
                      : 'border-transparent text-sidebar-muted-foreground hover:border-sidebar-border hover:bg-sidebar-accent/50'
                  )}
                >
                  <Icon className={cn('h-5 w-5 shrink-0', isCollapsed && 'mx-auto')} />
                  
                  {!isCollapsed && (
                    <>
                      <div className="flex-1 flex flex-col gap-0.5">
                        <span className="font-semibold tracking-tight">{item.label}</span>
                        <span className="text-[10px] text-sidebar-muted-foreground">
                          $ {item.command}
                        </span>
                      </div>
                      {item.badge && (
                        <span className={cn(
                          'px-2 py-0.5 text-[10px] font-bold border font-mono tracking-wide',
                          isActive 
                            ? 'border-sidebar-primary text-sidebar-primary'
                            : 'border-sidebar-border text-sidebar-muted-foreground'
                        )}>
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-3 border-t-2 border-sidebar-border space-y-2">
        {/* Scrolling Banner Toggle */}
        <button
          onClick={() => updateScreenerSettings({ showScrollingBanner: !screenerSettings.showScrollingBanner })}
          className={cn(
            'w-full flex items-center gap-2 px-2 py-2.5 border-2 border-sidebar-border hover:bg-sidebar-accent transition-colors font-mono text-xs text-sidebar-muted-foreground',
            isCollapsed && 'justify-center px-1'
          )}
          aria-label="Toggle scrolling banner"
        >
          <ScrollText className="h-5 w-5 shrink-0" />
          {!isCollapsed && (
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="font-semibold tracking-tight truncate text-[11px]">
                {screenerSettings.showScrollingBanner ? 'Hide' : 'Show'} Banner
              </span>
              <span className="text-[9px] text-sidebar-muted-foreground truncate">
                $ ticker_scroll
              </span>
            </div>
          )}
        </button>

        {/* Font Toggle */}
        <button
          onClick={toggleFontTheme}
          className={cn(
            'w-full flex items-center gap-2 px-2 py-2.5 border-2 border-sidebar-border hover:bg-sidebar-accent transition-colors font-mono text-xs text-sidebar-muted-foreground',
            isCollapsed && 'justify-center px-1'
          )}
          aria-label="Toggle font theme"
          suppressHydrationWarning
        >
          <Type className="h-5 w-5 shrink-0" />
          {!isCollapsed && (
            <div className="flex flex-col gap-0.5 min-w-0" suppressHydrationWarning>
              <span className="font-semibold tracking-tight truncate text-[11px]" suppressHydrationWarning>
                {mounted ? (fontTheme === 'alpina' ? 'GT Alpina' : 'Default Sans') : 'Default Sans'}
              </span>
              <span className="text-[9px] text-sidebar-muted-foreground truncate">
                $ font_family
              </span>
            </div>
          )}
        </button>

        <div className="flex gap-2">
          {/* Theme Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  'flex-1 flex items-center gap-2 px-2 py-2.5 border-2 border-sidebar-border hover:bg-sidebar-accent transition-colors font-mono text-xs text-sidebar-muted-foreground',
                  isCollapsed && 'justify-center px-1'
                )}
                aria-label="Change theme"
                suppressHydrationWarning
              >
                <CurrentThemeIcon className="h-5 w-5 shrink-0" />
                {!isCollapsed && (
                  <div className="flex flex-col gap-0.5 min-w-0 text-left" suppressHydrationWarning>
                    <span className="font-semibold tracking-tight truncate text-[11px]" suppressHydrationWarning>
                      {mounted ? (themes.find(t => t.id === theme)?.label || 'Theme') : 'Theme'}
                    </span>
                    <span className="text-[9px] text-sidebar-muted-foreground truncate">
                      $ theme
                    </span>
                  </div>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>Select Theme</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {themes.map((t) => (
                <DropdownMenuItem key={t.id} onClick={() => changeTheme(t.id)}>
                  <t.icon className="mr-2 h-4 w-4" />
                  <span>{t.label}</span>
                  {theme === t.id && (
                    <span className="ml-auto text-xs text-muted-foreground">Active</span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {!isCollapsed ? (
            <div className="flex-1 relative color-picker-container">
              <button
                onClick={() => setIsColorPickerOpen(!isColorPickerOpen)}
                className="w-full flex items-center gap-2 px-2 py-2.5 border-2 border-sidebar-border hover:bg-sidebar-accent transition-colors font-mono text-xs text-sidebar-muted-foreground"
                aria-label="Change accent color"
                suppressHydrationWarning
              >
                <div 
                  className="h-5 w-5 shrink-0 border-2 border-sidebar-border"
                  style={{ backgroundColor: accentColors.find(c => c.name === accentColor)?.value }}
                  suppressHydrationWarning
                />
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-semibold tracking-tight truncate text-[11px]">
                    Accent
                  </span>
                  <span className="text-[9px] text-sidebar-muted-foreground truncate">
                    $ color
                  </span>
                </div>
              </button>
              
              {isColorPickerOpen && (
                <div className="absolute bottom-full left-0 mb-1 w-full bg-sidebar border-2 border-sidebar-border z-50">
                  <div className="p-2 space-y-1">
                    {accentColors.map((color) => (
                      <button
                        key={color.name}
                        onClick={() => changeAccentColor(color.name)}
                        className={cn(
                          'w-full flex items-center gap-2 px-2 py-1.5 border border-sidebar-border hover:bg-sidebar-accent transition-colors font-mono text-xs',
                          accentColor === color.name && 'bg-sidebar-accent border-sidebar-primary'
                        )}
                      >
                        <div 
                          className="h-4 w-4 shrink-0 border border-sidebar-border"
                          style={{ backgroundColor: color.value }}
                        />
                        <span className="text-sidebar-foreground font-semibold">{color.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex justify-center items-center">
              <button
                onClick={() => setIsColorPickerOpen(!isColorPickerOpen)}
                className="h-full w-full flex justify-center items-center"
              >
                <div 
                  className="h-8 w-8 border-2 border-sidebar-border"
                  style={{ backgroundColor: accentColors.find(c => c.name === accentColor)?.value }}
                />
              </button>
              {isColorPickerOpen && (
                <div className="absolute left-16 bottom-0 w-32 bg-sidebar border-2 border-sidebar-border z-50">
                  <div className="p-2 space-y-1">
                    {accentColors.map((color) => (
                      <button
                        key={color.name}
                        onClick={() => changeAccentColor(color.name)}
                        className={cn(
                          'w-full flex items-center gap-2 px-2 py-1.5 border border-sidebar-border hover:bg-sidebar-accent transition-colors font-mono text-xs',
                          accentColor === color.name && 'bg-sidebar-accent border-sidebar-primary'
                        )}
                      >
                        <div 
                          className="h-4 w-4 shrink-0 border border-sidebar-border"
                          style={{ backgroundColor: color.value }}
                        />
                        <span className="text-sidebar-foreground font-semibold">{color.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        
        {!isCollapsed ? (
          <div className="bg-sidebar-accent border border-sidebar-border p-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-2 w-2 bg-emerald-500" />
              <span className="font-mono font-semibold text-xs text-sidebar-foreground tracking-tight">ONLINE</span>
            </div>
            <div className="font-mono text-[10px] text-sidebar-muted-foreground">
              $ system_status: operational
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <div className="h-2 w-2 bg-emerald-500" />
          </div>
        )}
      </div>
    </aside>
  )
})
