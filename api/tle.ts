const DEFAULT_CATNR = '58016'

const SATELLITE_CATALOG: Record<
  string,
  {
    name: string
    shortName: string
  }
> = {
  '58016': {
    name: 'THEOS-2 (T2V)',
    shortName: 'THEOS-2',
  },
  '33396': {
    name: 'THEOS',
    shortName: 'THEOS',
  },
  '39084': {
    name: 'LANDSAT-8',
    shortName: 'LANDSAT-8',
  },
  '49260': {
    name: 'LANDSAT-9',
    shortName: 'LANDSAT-9',
  },
  '32382': {
    name: 'RADARSAT-2',
    shortName: 'RADARSAT-2',
  },
}

const FALLBACK_TLE: Record<
  string,
  {
    name: string
    line1: string
    line2: string
  }
> = {
  '58016': {
    name: 'THEOS-2 (T2V)',
    line1:
      '1 58016U 23155A   26167.30252541  .00000718  00000+0  97728-4 0  9992',
    line2:
      '2 58016  97.8882 238.2982 0001397  90.9329 269.2044 14.81738778145292',
  },
}

function getCatnrFromRequest(req: any) {
  const rawCatnr = String(req.query?.catnr || DEFAULT_CATNR).trim()

  if (!/^\d{1,6}$/.test(rawCatnr)) {
    return DEFAULT_CATNR
  }

  return rawCatnr
}

function parseTleText(text: string, catnr: string) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const line1Index = lines.findIndex((line) => line.startsWith('1 '))

  if (line1Index < 0 || line1Index + 1 >= lines.length) {
    throw new Error('TLE line 1 not found')
  }

  const nameLine =
    line1Index > 0
      ? lines[line1Index - 1]
      : SATELLITE_CATALOG[catnr]?.name || `SAT-${catnr}`

  const line1 = lines[line1Index]
  const line2 = lines[line1Index + 1]

  if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
    throw new Error('Invalid TLE format')
  }

  return {
    name: nameLine,
    line1,
    line2,
  }
}

async function fetchTleFromCelesTrak(catnr: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 9000)

  try {
    const url = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${encodeURIComponent(
      catnr,
    )}&FORMAT=TLE`

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'theos2-orbit-theater/1.0',
      },
    })

    if (!response.ok) {
      throw new Error(`CelesTrak HTTP ${response.status}`)
    }

    const text = await response.text()
    return parseTleText(text, catnr)
  } finally {
    clearTimeout(timeout)
  }
}

export default async function handler(req: any, res: any) {
  const catnr = getCatnrFromRequest(req)
  const catalogInfo = SATELLITE_CATALOG[catnr]

  try {
    const tle = await fetchTleFromCelesTrak(catnr)

    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400')
    res.status(200).json({
      name: tle.name || catalogInfo?.name || `SAT-${catnr}`,
      shortName: catalogInfo?.shortName || tle.name || `SAT-${catnr}`,
      line1: tle.line1,
      line2: tle.line2,
      catnr,
      source: 'CelesTrak',
      fetchedAt: new Date().toISOString(),
      fallback: false,
    })
  } catch (error: any) {
    const fallback = FALLBACK_TLE[catnr]

    if (fallback) {
      res.setHeader('Cache-Control', 's-maxage=300')
      res.status(200).json({
        name: fallback.name,
        shortName: SATELLITE_CATALOG[catnr]?.shortName || fallback.name,
        line1: fallback.line1,
        line2: fallback.line2,
        catnr,
        source: 'Fallback',
        fetchedAt: null,
        fallback: true,
        error: error?.message || 'Unable to fetch TLE',
      })
      return
    }

    res.status(502).json({
      name: catalogInfo?.name || `SAT-${catnr}`,
      shortName: catalogInfo?.shortName || `SAT-${catnr}`,
      line1: '',
      line2: '',
      catnr,
      source: 'Unavailable',
      fetchedAt: null,
      fallback: false,
      error: error?.message || 'Unable to fetch TLE',
    })
  }
}