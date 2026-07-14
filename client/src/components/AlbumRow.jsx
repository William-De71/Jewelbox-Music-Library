import { StarRating } from './StarRating.jsx';
import { usePlayer } from './PlayerContext.jsx';
import { useI18n } from '../config/i18n/index.jsx';
import { Play } from 'lucide-preact';
import { getPlaceholderSVG } from '../utils/placeholder.js';

export function AlbumRow({ album, onClick }) {
  const { t } = useI18n();
  const { playAlbumById } = usePlayer();

  return (
    <tr class="hover:bg-light-lt cursor-pointer" onClick={() => onClick(album)}>
      <td class="text-center d-none d-sm-table-cell">
        <div class="d-flex align-items-center justify-content-center" 
          style={{width: '40px', height: '40px'}}>
          {album.cover_url ? (
            <img 
              src={album.cover_url} 
              alt={album.title}
              class="rounded"
              style={{width: '40px', height: '40px', objectFit: 'cover'}}
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.parentElement.innerHTML = getPlaceholderSVG();
              }}
            />
          ) : (
            <div dangerouslySetInnerHTML={{__html: getPlaceholderSVG()}}></div>
          )}
        </div>
      </td>
      <td class="fw-medium">
        {album.has_audio && (
          <button
            class="btn btn-sm btn-icon btn-ghost-primary me-1 align-middle"
            title={t('player.playAlbum')}
            onClick={(e) => { e.stopPropagation(); playAlbumById(album.id); }}
          >
            <Play size={14} />
          </button>
        )}
        {album.title}
      </td>
      <td class="text-muted">{album.artist?.name || album.artist}</td>
      <td class="text-muted d-none d-lg-table-cell">{album.year || '—'}</td>
      <td class="d-none d-lg-table-cell">
        {album.genre ? <span class="badge bg-primary-lt">{album.genre}</span> : '—'}
      </td>
      <td class="d-none d-md-table-cell">
        <StarRating value={album.rating} readOnly />
      </td>
      <td class="text-muted small d-none d-md-table-cell">{album.label?.name || album.label || '—'}</td>
    </tr>
  );
}
