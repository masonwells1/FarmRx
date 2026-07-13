import { NavLink } from 'react-router-dom'

/** Header tab bar inside a section (Farm Profit Manager pattern, Mason-approved 2026-07-13):
 * the left sidebar picks the section, these tabs pick the page within it. */
export function SectionTabs({ base, tabs }: { base: string; tabs: Array<{ slug: string; label: string }> }) {
  return <nav className="section-tabs" aria-label="Section pages">
    {tabs.map((tab) => <NavLink key={tab.slug} to={tab.slug ? `${base}/${tab.slug}` : base} end={tab.slug === ''} className={({ isActive }) => isActive ? 'active' : undefined}>{tab.label}</NavLink>)}
  </nav>
}
