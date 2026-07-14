import { StarRating } from './StarRating.jsx';
import { useI18n } from '../config/i18n/index.jsx';
import { usePlayer } from './PlayerContext.jsx';
import { Share, Play } from 'lucide-preact';
import { getPlaceholderHTML } from '../utils/placeholder.js';


export function AlbumCard({ album, onClick, onEdit, onDelete, onLend, onRate }) {
  const { t } = useI18n();
  const { playAlbumById } = usePlayer();

  return (
    <div class="card shadow-sm h-100">
      {/* Header with cover image and "lent" badge */}
      <div class="position-relative" onClick={() => onClick(album)}>
        <div class="ratio ratio-1x1 bg-transparent d-flex align-items-center justify-content-center">
          {album.cover_url ? (
            <>
              <img 
                src={album.cover_url} 
                alt={album.title}
                class="img-fluid w-100 h-100 object-fit-cover p-2"
                onError={(e) => {
                  e.target.style.display = 'none';
                  // Show placeholder by replacing the img
                  const placeholder = document.createElement('div');
                  placeholder.className = 'd-flex align-items-center justify-content-center w-100 h-100';
                  placeholder.innerHTML = getPlaceholderHTML();
                  e.target.parentNode.replaceChild(placeholder, e.target);
                }}
              />
            </>
          ) : (
            <div class="d-flex align-items-center justify-content-center w-100 h-100" 
                dangerouslySetInnerHTML={{__html: getPlaceholderHTML()}}>
            </div>
          )}
          
      </div>

        {album.is_lent && (
          <span class="badge bg-warning text-dark position-absolute top-0 end-0 m-2">
            <Share size={16} class="me-1" />
            {t('card.lentBadge')}{album.lent_to ? ` ${t('card.lentTo', { name: album.lent_to })}` : ''}
          </span>
        )}

        {album.has_audio && (
          <button
            class="btn btn-primary btn-icon album-card-play"
            title={t('player.playAlbum')}
            onClick={(e) => { e.stopPropagation(); playAlbumById(album.id); }}
          >
            <Play size={18} />
          </button>
        )}
      </div>

      {/* Corps avec Rating */}
      <div class="card-body p-3" onClick={(e) => e.stopPropagation()}>
        <StarRating value={album.rating} onChange={(rating) => onRate && onRate(album, rating)} />
      </div>
      
      {/* Footer avec informations albums */}
      <div class="card-footer bg-transparent border-0 p-3 pt-0" onClick={() => onClick(album)}>
        <h5 class="card-title mb-1 text-truncate">{album.title}</h5>
        <p class="card-text text-muted small mb-2 text-truncate">
          {album.artist?.name || album.artist}
        </p>
      </div>


    </div>
  );
}