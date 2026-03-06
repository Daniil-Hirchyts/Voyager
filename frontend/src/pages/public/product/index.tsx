import { Link } from 'react-router-dom'
import { ArrowRight, Zap, LayoutGrid, Map, Compass, FileText, RefreshCw } from 'lucide-react'

const features = [
  {
    icon: Zap,
    title: 'AI Itinerary Generation',
    subtitle: 'From brief to full itinerary in seconds',
    body: 'Describe your trip in natural language — destination, dates, travel style, budget constraints, dietary needs. Voyager\'s generation engine produces a structured, day-by-day itinerary with real activities, estimated durations, and logical sequencing. You can regenerate sections, append new days, or refine with plain-language instructions.',
    tags: ['Natural language input', 'Section-level regeneration', 'Constraint-aware'],
  },
  {
    icon: LayoutGrid,
    title: 'Structured Planner Board',
    subtitle: 'Your itinerary as durable, editable data',
    body: 'Unlike text-based travel planners, Voyager represents every activity as a structured record — with title, time, duration, place, cost, and tags. Drag activities between days, reorder within a day, bulk-move, or edit any field inline. The planner board is optimistic by default: your changes are reflected immediately while syncing in the background.',
    tags: ['Drag & drop reorder', 'Inline editing', 'Optimistic updates'],
  },
  {
    icon: Map,
    title: 'Geospatial & Places',
    subtitle: 'An atlas for your itinerary',
    body: 'Every activity can be pinned to a real place. Browse the map to find what\'s nearby, attach places to activities, and see your full day laid out geographically. The map uses an atlas-inspired style that feels like a beautiful travel journal — not a generic tile map.',
    tags: ['Activity-to-place attachment', 'Nearby discovery', 'Day view on map'],
  },
  {
    icon: FileText,
    title: 'Export & Share',
    subtitle: 'Take your plan anywhere',
    body: 'Export your itinerary as a structured PDF, Markdown, or JSON. Share a read-only link with travel companions. The export preserves all structure — days, activities, places, and notes — formatted beautifully for print or digital sharing.',
    tags: ['PDF export', 'Markdown export', 'Read-only share links'],
  },
  {
    icon: RefreshCw,
    title: 'Concurrent-Safe Editing',
    subtitle: 'No accidental overwrites',
    body: 'Voyager uses optimistic concurrency control throughout. Every trip and activity carries a version number. If two sessions edit the same resource simultaneously, Voyager detects the conflict, notifies you immediately, and lets you merge gracefully — your work is never silently overwritten.',
    tags: ['If-Match headers', 'Conflict detection', 'Version history'],
  },
  {
    icon: Compass,
    title: 'Multi-Trip Dashboard',
    subtitle: 'All your journeys in one place',
    body: 'The trip dashboard gives you a bird\'s-eye view of all your travel plans — upcoming, in-progress, and past. Filter by type, destination, or date. Duplicate a previous trip as a template for a new one. Each trip is isolated and independently shareable.',
    tags: ['Trip templates', 'Duplicate & remix', 'Status tracking'],
  },
]

export default function ProductPage() {
  return (
    <div style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
      {/* Navigation */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4"
        style={{
          background: 'rgba(244, 235, 221, 0.85)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(205, 190, 168, 0.4)',
        }}
      >
        <Link to="/" className="font-display text-2xl text-[#2F6F73] tracking-tight">
          Voyager
        </Link>
        <div className="flex items-center gap-6">
          <Link to="/product" className="text-sm text-[#526072] font-medium text-[#1D2430]">
            Product
          </Link>
          <Link
            to="/how-it-works"
            className="text-sm text-[#526072] hover:text-[#1D2430] transition-colors"
          >
            How It Works
          </Link>
          <Link
            to="/signin"
            className="flex items-center gap-2 px-5 py-2.5 bg-[#2F6F73] text-white text-sm font-medium rounded-[10px] hover:bg-[#266063] transition-colors"
          >
            Get Started <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section
        className="pt-36 pb-24 px-6 text-center"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(47, 111, 115, 0.1) 0%, transparent 60%), var(--color-bg)',
        }}
      >
        <div className="max-w-3xl mx-auto">
          <p className="text-xs tracking-[0.3em] uppercase text-[#2F6F73] mb-6 font-medium">
            Product Overview
          </p>
          <h1
            className="font-display leading-tight mb-6"
            style={{ fontSize: 'clamp(2.5rem, 6vw, 5rem)', color: '#1D2430' }}
          >
            Everything you need to plan a journey worth telling
          </h1>
          <p className="text-lg text-[#526072] leading-relaxed max-w-2xl mx-auto">
            Voyager combines AI generation with a structured, editable planner — so your itinerary
            is never just a text blob. Every activity is real data you can see, edit, and map.
          </p>
        </div>
      </section>

      {/* Feature sections */}
      <section className="py-8 px-6" style={{ background: 'var(--color-bg-deep)' }}>
        <div className="max-w-5xl mx-auto space-y-2">
          {features.map((feat, i) => (
            <div
              key={feat.title}
              className="p-8 rounded-[24px] border"
              style={{
                background: i % 2 === 0 ? 'var(--color-surface)' : 'var(--color-bg)',
                borderColor: 'var(--color-border)',
              }}
            >
              <div className="flex flex-col md:flex-row md:items-start gap-6">
                <div className="md:w-64 shrink-0">
                  <div className="w-12 h-12 rounded-[14px] bg-[#2F6F73]/10 flex items-center justify-center mb-4">
                    <feat.icon className="w-6 h-6 text-[#2F6F73]" />
                  </div>
                  <h2 className="font-semibold text-[#1D2430] text-lg mb-1">{feat.title}</h2>
                  <p className="text-sm text-[#526072] italic">{feat.subtitle}</p>
                </div>
                <div className="flex-1">
                  <p className="text-[#526072] leading-relaxed mb-4">{feat.body}</p>
                  <div className="flex flex-wrap gap-2">
                    {feat.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-xs px-2.5 py-1 rounded-full border font-medium"
                        style={{
                          background: 'var(--color-bg)',
                          borderColor: 'var(--color-border)',
                          color: '#526072',
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Design principles */}
      <section className="py-24 px-6" style={{ background: 'var(--color-bg)' }}>
        <div className="max-w-4xl mx-auto">
          <h2
            className="font-display text-center mb-4"
            style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', color: '#1D2430' }}
          >
            Designed for the way you travel
          </h2>
          <p className="text-center text-[#526072] mb-16 max-w-xl mx-auto">
            Voyager is built on a few core principles that shape every design decision.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                title: 'Data over text',
                desc: "An AI itinerary is only useful if you can edit it. Voyager stores every activity as structured data, not free-form text — so you're always in control.",
              },
              {
                title: 'Warm but efficient',
                desc: "The public experience feels like a premium travel journal. The planner is calm and efficient — no clutter, no distractions, just your trip.",
              },
              {
                title: 'Conflict-safe by default',
                desc: "Edit from multiple devices or share with a travel partner — Voyager detects concurrent edits and handles them gracefully, never overwriting your work silently.",
              },
              {
                title: 'Incrementally AI',
                desc: "The AI generates; you curate. You can regenerate any section, append days, or replace specific activities without losing your manual edits.",
              },
            ].map((p) => (
              <div
                key={p.title}
                className="p-6 rounded-[18px] border"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
              >
                <h3 className="font-semibold text-[#1D2430] mb-2">{p.title}</h3>
                <p className="text-sm text-[#526072] leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        className="py-32 px-6 text-center"
        style={{
          background:
            'linear-gradient(135deg, rgba(47, 111, 115, 0.08) 0%, rgba(197, 106, 61, 0.06) 100%), var(--color-bg-deep)',
        }}
      >
        <div className="max-w-2xl mx-auto">
          <h2
            className="font-display mb-6"
            style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', color: '#1D2430' }}
          >
            Ready to plan your next journey?
          </h2>
          <p className="text-[#526072] mb-10 leading-relaxed">
            Create your first trip and experience what AI-assisted travel planning should feel like.
          </p>
          <div className="flex items-center gap-4 justify-center">
            <Link
              to="/signin"
              className="inline-flex items-center gap-2.5 px-10 py-4 bg-[#2F6F73] text-white font-medium rounded-[10px] hover:bg-[#266063] transition-all hover:shadow-lg hover:shadow-[#2F6F73]/20"
            >
              Start for free <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/how-it-works"
              className="inline-flex items-center gap-2 px-6 py-4 text-[#526072] hover:text-[#1D2430] text-sm font-medium transition-colors"
            >
              See how it works
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 px-8" style={{ borderColor: 'var(--color-border)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="font-display text-xl text-[#2F6F73]">Voyager</span>
          <div className="flex items-center gap-6">
            <Link
              to="/"
              className="text-sm text-[#526072] hover:text-[#1D2430] transition-colors"
            >
              Home
            </Link>
            <Link
              to="/how-it-works"
              className="text-sm text-[#526072] hover:text-[#1D2430] transition-colors"
            >
              How It Works
            </Link>
          </div>
          <p className="text-sm text-[#526072]">AI-powered travel planning</p>
        </div>
      </footer>
    </div>
  )
}
