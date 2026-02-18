# Kiyotaka.ai Integration Guide

## Trader Positioning Widget → Kiyotaka.ai Indicator

This guide explains how to use your trader positioning data as an indicator in kiyotaka.ai.

---

## Overview

Your trader positioning widget tracks Hyperliquid perpetual positions and provides:
- **Long/Short Ratio**: Ratio of long positions to short positions
- **Long Count**: Number of traders with long positions
- **Short Count**: Number of traders with short positions
- **Total Traders**: Total number of active traders
- **Long Notional**: Total notional value of long positions
- **Short Notional**: Total notional value of short positions

Data updates every **10 minutes** via snapshots from Hydromancer.

---

## API Endpoint

**URL**: `https://your-domain.com/api/kiyotaka-indicator`

**Query Parameters**:
- `coin` (optional): Symbol like `BTC`, `ETH`, `SOL` (default: `BTC`)
- `metric` (optional): One of `longShortRatio`, `longCount`, `shortCount`, `totalTraders`, `longNotional`, `shortNotional` (default: `longShortRatio`)
- `limit` (optional): Number of data points (default: `1000`, max: `10000`)
- `format` (optional): `timeseries` (default) or `json`

**Example Request**:
```
GET /api/kiyotaka-indicator?coin=BTC&metric=longShortRatio&limit=500
```

**Example Response** (timeseries format):
```json
{
  "coin": "BTC",
  "metric": "longShortRatio",
  "latest": 1.2345,
  "latestTimestamp": 1704067200000,
  "dataPoints": 500,
  "timeseries": [
    {
      "timestamp": 1704067200000,
      "value": 1.2345
    },
    ...
  ]
}
```

---

## Integration Steps

### Step 1: Contact kiyotaka.ai Support

Reach out to kiyotaka.ai support to add your API as a custom data source. Provide them:

1. **API Endpoint URL**: `https://your-domain.com/api/kiyotaka-indicator`
2. **Data Format**: JSON timeseries with `timestamp` and `value` fields
3. **Update Frequency**: Every 10 minutes
4. **Supported Coins**: List of available coins (BTC, ETH, SOL, etc.)
5. **Available Metrics**: 
   - `longShortRatio`
   - `longCount`
   - `shortCount`
   - `totalTraders`
   - `longNotional`
   - `shortNotional`

### Step 2: Once Integrated

After kiyotaka.ai adds your data source, you'll be able to access it in KScript v2. The exact function name will depend on how they integrate it, but it might look like:

```javascript
// Hypothetical - actual function name depends on kiyotaka.ai implementation
timeseries traderPositioning = trader_positioning(
    symbol=currentCoin,  // "BTC", "ETH", etc.
    metric="longShortRatio"  // or "longCount", "shortCount", etc.
)
```

---

## Example KScript v2 Indicators

Once integrated, here are example indicators you can build:

### Example 1: Long/Short Ratio Indicator

```javascript
//@version=2
define(title="Trader Positioning - L/S Ratio", position="offchart", axis=true)

// Inputs
var coin = input(name="coin", type="string", defaultValue="BTC", label="Coin")
var showLevels = input(name="showLevels", type="boolean", defaultValue=true, label="Show Levels")

// Data (assuming integration provides this function)
// NOTE: Actual function name depends on kiyotaka.ai implementation
timeseries lsRatio = trader_positioning(symbol=coin, metric="longShortRatio")

// Price data for context
timeseries ohlcvData = ohlcv(symbol=currentSymbol, exchange=currentExchange)
timeseries closePrice = ohlcvData.close

// Calculate extremes
var lookback = 100
var maxRatio = highest(source=lsRatio, period=lookback, priceIndex=0)
var minRatio = lowest(source=lsRatio, period=lookback, priceIndex=0)

// Color based on ratio
var colorIdx = 0
if (lsRatio[0] > 1.0) {
    colorIdx = 0  // Green (more longs)
} else {
    colorIdx = 1  // Red (more shorts)
}

// Plot
plotLine(
    value=lsRatio,
    width=2,
    colors=["#00ff00", "#ff0000"],
    colorIndex=colorIdx,
    label=["L/S Ratio"],
    desc=["Long/Short Ratio"]
)

// Reference lines
if (showLevels) {
    hline(value=1.0, color="#808080", width=1)  // Neutral
    hline(value=1.5, color="#00ff00", width=1)   // Bullish
    hline(value=0.5, color="#ff0000", width=1)  // Bearish
}

// Signals
var bullishSignal = lsRatio[0] > 1.5 && lsRatio[1] <= 1.5
var bearishSignal = lsRatio[0] < 0.5 && lsRatio[1] >= 0.5

if (bullishSignal) {
    plotShape(
        value=closePrice,
        shape="triangle",
        colors=["#00ff00"],
        fill=true,
        width=2,
        label=["Bullish"],
        desc=["L/S Ratio > 1.5"]
    )
}

if (bearishSignal) {
    plotShape(
        value=closePrice,
        shape="triangle",
        colors=["#ff0000"],
        fill=true,
        width=2,
        label=["Bearish"],
        desc=["L/S Ratio < 0.5"]
    )
}
```

### Example 2: Trader Count vs Price Divergence

```javascript
//@version=2
define(title="Trader Count Divergence", position="offchart", axis=true)

// Inputs
var coin = input(name="coin", type="string", defaultValue="BTC", label="Coin")
var lookback = input(name="lookback", type="number", defaultValue=20, label="Lookback Period")

// Data
timeseries totalTraders = trader_positioning(symbol=coin, metric="totalTraders")
timeseries ohlcvData = ohlcv(symbol=currentSymbol, exchange=currentExchange)
timeseries closePrice = ohlcvData.close
timeseries lowPrice = ohlcvData.low
timeseries highPrice = ohlcvData.high

// Normalize trader count for comparison (scale to price range)
var priceRange = highest(source=ohlcvData, period=lookback, priceIndex=2) - lowest(source=ohlcvData, period=lookback, priceIndex=3)
var traderRange = highest(source=totalTraders, period=lookback, priceIndex=0) - lowest(source=totalTraders, period=lookback, priceIndex=0)

var normalizedTraders = 0.0
if (traderRange > 0) {
    normalizedTraders = ((totalTraders[0] - lowest(source=totalTraders, period=lookback, priceIndex=0)) / traderRange) * priceRange + lowest(source=ohlcvData, period=lookback, priceIndex=3)
}

// Detect divergences
var bullishDivergence = false
var bearishDivergence = false

if (barIndex >= lookback * 2) {
    // Bullish: Price makes lower low, but traders increase
    var priceLowerLow = lowPrice[0] < lowPrice[lookback]
    var tradersHigher = totalTraders[0] > totalTraders[lookback]
    bullishDivergence = priceLowerLow && tradersHigher

    // Bearish: Price makes higher high, but traders decrease
    var priceHigherHigh = highPrice[0] > highPrice[lookback]
    var tradersLower = totalTraders[0] < totalTraders[lookback]
    bearishDivergence = priceHigherHigh && tradersLower
}

// Plot price
plotLine(
    value=closePrice,
    width=2,
    colors=["#2196f3"],
    label=["Price"],
    desc=["Close Price"]
)

// Plot normalized trader count
plotLine(
    value=normalizedTraders,
    width=2,
    colors=["#ffc107"],
    label=["Traders"],
    desc=["Normalized Trader Count"]
)

// Mark divergences
if (bullishDivergence) {
    plotShape(
        value=lowPrice,
        shape="circle",
        colors=["#00ff00"],
        fill=true,
        width=3,
        label=["Bull Div"],
        desc=["Bullish Divergence"]
    )
}

if (bearishDivergence) {
    plotShape(
        value=highPrice,
        shape="circle",
        colors=["#ff0000"],
        fill=true,
        width=3,
        label=["Bear Div"],
        desc=["Bearish Divergence"]
    )
}
```

### Example 3: Combined Positioning Dashboard

```javascript
//@version=2
define(title="Trader Positioning Dashboard", position="offchart", axis=true)

// Inputs
var coin = input(name="coin", type="string", defaultValue="BTC", label="Coin")

// All positioning metrics
timeseries lsRatio = trader_positioning(symbol=coin, metric="longShortRatio")
timeseries longCount = trader_positioning(symbol=coin, metric="longCount")
timeseries shortCount = trader_positioning(symbol=coin, metric="shortCount")
timeseries totalTraders = trader_positioning(symbol=coin, metric="totalTraders")

// Normalize counts to 0-100 range for display
var maxTraders = highest(source=totalTraders, period=200, priceIndex=0)
var normalizedLongs = maxTraders > 0 ? (longCount[0] / maxTraders) * 100 : 0
var normalizedShorts = maxTraders > 0 ? (shortCount[0] / maxTraders) * 100 : 0

// Plot L/S Ratio (main indicator)
plotLine(
    value=lsRatio,
    width=2,
    colors=["#00ff00", "#ff0000"],
    colorIndex=lsRatio[0] > 1.0 ? 0 : 1,
    label=["L/S Ratio"],
    desc=["Long/Short Ratio"]
)

// Plot normalized counts as histogram
plotBar(
    value=normalizedLongs,
    width=1,
    colors=["#00ff00"],
    label=["Longs"],
    desc=["Long Positions"]
)

plotBar(
    value=normalizedShorts,
    width=1,
    colors=["#ff0000"],
    label=["Shorts"],
    desc=["Short Positions"]
)

// Reference lines
hline(value=1.0, color="#808080", width=1)
hline(value=50, color="#808080", width=1)
```

---

## Alternative: Manual Integration via Webhook/Stream

If kiyotaka.ai doesn't support custom HTTP data sources, you could:

1. **Set up a WebSocket stream** from your API that kiyotaka.ai can subscribe to
2. **Use kiyotaka.ai's WebSocket integration** (if available)
3. **Create a bridge service** that formats your data into a format kiyotaka.ai accepts

---

## Testing Your API

Test your endpoint locally:

```bash
# Get BTC long/short ratio
curl "http://localhost:4200/api/kiyotaka-indicator?coin=BTC&metric=longShortRatio&limit=100"

# Get ETH trader count
curl "http://localhost:4200/api/kiyotaka-indicator?coin=ETH&metric=totalTraders&limit=500"

# Get all metrics in JSON format
curl "http://localhost:4200/api/kiyotaka-indicator?coin=BTC&format=json&limit=10"
```

---

## Notes

- **Data Frequency**: Updates every 10 minutes (matches Hydromancer snapshot interval)
- **Historical Data**: Available back to when you started collecting snapshots
- **Supported Coins**: Any coin tracked by your `fetch-trader-snapshots` Supabase function
- **Data Source**: Hyperliquid perpetual positions via Hydromancer API

---

## Support

For questions about:
- **Your API**: Check `/app/api/kiyotaka-indicator/route.ts`
- **Data Collection**: Check `/supabase/functions/fetch-trader-snapshots/`
- **Kiyotaka.ai Integration**: Contact kiyotaka.ai support
