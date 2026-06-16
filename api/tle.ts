const THEOS2_CATNR = '58016'

const CELESTRAK_TLE_URL = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${THEOS2_CATNR}&FORMAT=TLE`

function parseTleText(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const line1Index = lines.findIndex((line) =>
    line.startsWith(`1 ${THEOS2_CATNR}`),
  )

  if (line1Index < 0) {
    throw new Error('THEOS-2 TLE line 1 not found')
  }

  const line1 = lines[line1Index]
  const line2 = lines[line1Index + 1]
  const nameLine = lines[line1Index - 1]

  if (!line2 || !line2.startsWith(`2 ${THEOS2_CATNR}`)) {
    throw new Error('THEOS-2 TLE line 2 not found')
  }

  return {
    name: nameLine && !nameLine.startsWith('1 ') ? nameLine : 'THEOS-2',
    line1,
    line2,
  }
}

export default {
  async fetch(request: Request) {
    if (request.method !== 'GET') {
      return new Response(
        JSON.stringify({
          error: 'Method not allowed',
        }),
        {
          status: 405,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
          },
        },
      )
    }

    try {
      const response = await fetch(CELESTRAK_TLE_URL, {
        headers: {
          'User-Agent': 'THEOS-2-Orbit-Theater/1.0',
        },
      })

      if (!response.ok) {
        throw new Error(`CelesTrak response error: ${response.status}`)
      }

      const text = await response.text()
      const tle = parseTleText(text)

      return new Response(
        JSON.stringify({
          ...tle,
          catnr: THEOS2_CATNR,
          source: 'CelesTrak',
          fetchedAt: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 's-maxage=21600, stale-while-revalidate=43200',
            'Access-Control-Allow-Origin': '*',
          },
        },
      )
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
          catnr: THEOS2_CATNR,
          source: 'CelesTrak',
          fetchedAt: new Date().toISOString(),
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          },
        },
      )
    }
  },
}