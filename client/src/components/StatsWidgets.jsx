// Small building blocks shared by the statistics tabs.

export function HBar({ data, color, labelWidth = 90 }) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div class="d-flex flex-column gap-2">
      {data.map((item, i) => (
        <div key={i} class="d-flex align-items-center gap-2">
          <span class="text-end text-muted flex-shrink-0 text-truncate"
            style={{ fontSize: '0.75rem', minWidth: labelWidth, maxWidth: labelWidth }}
            title={item.label}>
            {item.label}
          </span>
          <div class="flex-grow-1 rounded overflow-hidden" style={{ height: 16, background: 'var(--tblr-secondary-lt, #e9ecef)' }}>
            <div style={{ width: `${(item.count / max) * 100}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.5s ease' }} />
          </div>
          <span class="fw-semibold flex-shrink-0" style={{ fontSize: '0.75rem', minWidth: 20 }}>{item.count}</span>
        </div>
      ))}
    </div>
  );
}

export function KpiCard({ icon, value, label, color }) {
  return (
    <div class="card text-center h-100">
      <div class="card-body py-3 px-2">
        <div class={`text-${color} mb-1`}>{icon}</div>
        <div class="display-6 fw-bold lh-1 mb-1">{value}</div>
        <div class="text-muted small">{label}</div>
      </div>
    </div>
  );
}
