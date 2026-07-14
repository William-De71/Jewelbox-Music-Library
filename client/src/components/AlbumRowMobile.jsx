import { Music2, Play } from 'lucide-preact';
import { usePlayer } from './PlayerContext.jsx';

export function AlbumRowMobile({ album, onClick, onEdit, onDelete, onLend, onRate, onAcquire, selectionMode, selected, onSelect }) {
  const { playAlbumById } = usePlayer();
  const handleClick = (e) => {
    if (selectionMode) {
      onSelect(album.id);
    } else if (onClick) {
      onClick(album);
    }
  };

  return (
    <div
      class="list-group-item list-group-item-action d-flex align-items-center gap-3 py-2"
      style={{ cursor: selectionMode || onClick ? 'pointer' : 'default' }}
      onClick={handleClick}
    >
      {selectionMode && (
        <div style={{ flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); onSelect(album.id); }}>
          {selected ? (
            <span class="text-primary">✓</span>
          ) : (
            <span class="text-muted">○</span>
          )}
        </div>
      )}

      {album.cover_url ? (
        <img src={album.cover_url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
      ) : (
        <div class="d-flex align-items-center justify-content-center bg-secondary-lt rounded" style={{ width: 40, height: 40, flexShrink: 0 }}>
          <Music2 size={18} class="text-muted" />
        </div>
      )}

      <div class="flex-grow-1 overflow-hidden">
        <div class="fw-semibold text-truncate small">{album.title}</div>
        <div class="text-muted" style={{ fontSize: '0.75rem' }}>{album.artist?.name || album.artist}</div>
      </div>

      {album.year && (
        <span class="text-muted flex-shrink-0" style={{ fontSize: '0.75rem' }}>{album.year}</span>
      )}

      {album.has_audio && !selectionMode && (
        <button
          class="btn btn-sm btn-icon btn-ghost-primary flex-shrink-0"
          onClick={(e) => { e.stopPropagation(); playAlbumById(album.id); }}
        >
          <Play size={16} />
        </button>
      )}
    </div>
  );
}
