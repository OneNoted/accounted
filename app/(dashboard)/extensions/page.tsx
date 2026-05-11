import { SECTORS } from '@/lib/extensions/sectors'
import ExtensionCard from '@/components/extensions/ExtensionCard'
import SectorCard from '@/components/extensions/SectorCard'

export default function ExtensionsPage() {
  const generalSector = SECTORS.find(s => s.slug === 'general')
  const industrySectors = SECTORS.filter(s => s.slug !== 'general')

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Tillägg</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Utöka ditt bokföringssystem med verktyg och branschspecifika funktioner.
        </p>
      </div>

      {/* General extensions */}
      {generalSector && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            {generalSector.name}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {generalSector.extensions.map(ext => (
              <ExtensionCard key={ext.slug} extension={ext} />
            ))}
          </div>
        </section>
      )}

      {/* Industry sectors */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Branschverktyg
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {industrySectors.map(sector => (
            <SectorCard key={sector.slug} sector={sector} />
          ))}
        </div>
      </section>
    </div>
  )
}
