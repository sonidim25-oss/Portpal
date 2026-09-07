const TEXT_SIZES = [
  { label: 'Standard', value: 1 },
  { label: 'Large', value: 1.15 },
  { label: 'Larger', value: 1.3 },
];

export function SettingsPage({ fontScale, onFontScale }: { fontScale: number; onFontScale(value: number): void }) {
  return (
    <div className="secondary-page">
      <header className="secondary-heading"><h2>Settings</h2><p>Appearance &amp; accessibility</p></header>
      <section className="secondary-settings-section">
        <div className="secondary-settings-row">
          <div><h3>Text size</h3><p>Scales every label, table and badge in PortPal.</p></div>
          <div className="secondary-size-group" role="group" aria-label="Text size">
            {TEXT_SIZES.map((size) => <button key={size.label} aria-pressed={fontScale === size.value} onClick={() => onFontScale(size.value)}>{size.label}</button>)}
          </div>
        </div>
        <div className="secondary-settings-preview"><span className="secondary-mono">:3000</span><span>vite — my-app</span><span className="secondary-state">Active</span></div>
      </section>
    </div>
  );
}
