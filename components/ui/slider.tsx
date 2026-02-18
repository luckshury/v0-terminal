"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

type SliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
  fancy?: boolean
}

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(({ className, fancy, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center group",
      className
    )}
    data-fancy={fancy ? "true" : "false"}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20 transition-all duration-200 group-data-[fancy=true]:h-6 group-data-[fancy=true]:rounded group-data-[fancy=true]:bg-gradient-to-r group-data-[fancy=true]:from-violet-600 group-data-[fancy=true]:via-emerald-400 group-data-[fancy=true]:to-yellow-400">
      <SliderPrimitive.Range className="absolute h-full bg-primary transition-all duration-150 ease-out group-data-[fancy=true]:bg-transparent" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 group-data-[fancy=true]:h-7 group-data-[fancy=true]:w-3 group-data-[fancy=true]:rounded-[2px] group-data-[fancy=true]:border-2 group-data-[fancy=true]:border-white/90 group-data-[fancy=true]:bg-white/10 group-data-[fancy=true]:shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_2px_4px_rgba(0,0,0,0.2)] group-data-[fancy=true]:backdrop-blur-sm group-data-[fancy=true]:transition-all group-data-[fancy=true]:duration-150 group-data-[fancy=true]:ease-out group-data-[fancy=true]:hover:scale-105 group-data-[fancy=true]:hover:border-white group-data-[fancy=true]:active:scale-95 group-data-[fancy=true]:focus-visible:ring-0" />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }

