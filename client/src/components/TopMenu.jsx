import { useState } from 'preact/hooks';
import { Home, Disc, Heart, ArrowRightLeft, BarChart3, Settings, Info, Menu, X, ListMusic } from 'lucide-preact';
import { useI18n } from '../config/i18n/index.jsx';
import '../styles/topmenu.css';

export function TopMenu({ currentPage, navigate }) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  
  const handleNavigate = (page) => {
    navigate(page);
    setIsOpen(false);
  };
  
  return (
    <nav class="navbar navbar-expand-lg">
      <div class="container">
        <button 
          class="navbar-toggler" 
          type="button" 
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Toggle navigation"
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        
        <div class={`collapse navbar-collapse ${isOpen ? 'show' : ''}`}>
          <ul class="navbar-nav me-auto">
          <li class="nav-item">
            <a 
              class={`nav-link ${currentPage === 'dashboard' ? 'active' : ''}`}
              href="#"
              onClick={(e) => { e.preventDefault(); handleNavigate('dashboard'); }}
            >
              <Home size={20} class="me-2" />
              {t('common.home')}
            </a>
          </li>
          <li class="nav-item">
            <a 
              class={`nav-link ${currentPage === 'collections' ? 'active' : ''}`}
              href="#"
              onClick={(e) => { e.preventDefault(); handleNavigate('collections'); }}
            >
              <Disc size={20} class="me-2" />
              {t('menu.collections')}
            </a>
          </li>
          <li class="nav-item">
            <a 
              class={`nav-link ${currentPage === 'wantlist' ? 'active' : ''}`}
              href="#"
              onClick={(e) => { e.preventDefault(); handleNavigate('wantlist'); }}
            >
              <Heart size={20} class="me-2" />
              {t('menu.wantlist')}
            </a>
          </li>
          <li class="nav-item">
            <a 
              class={`nav-link ${currentPage === 'lend' ? 'active' : ''}`}
              href="#"
              onClick={(e) => { e.preventDefault(); handleNavigate('lend'); }}
            >
              <ArrowRightLeft size={20} class="me-2" />
              {t('menu.lend')}
            </a>
          </li>
          <li class="nav-item">
            <a
              class={`nav-link ${currentPage === 'playlists' ? 'active' : ''}`}
              href="#"
              onClick={(e) => { e.preventDefault(); handleNavigate('playlists'); }}
            >
              <ListMusic size={20} class="me-2" />
              {t('menu.playlists')}
            </a>
          </li>
          <li class="nav-item">
            <a
              class={`nav-link ${currentPage === 'stats' ? 'active' : ''}`}
              href="#"
              onClick={(e) => { e.preventDefault(); handleNavigate('stats'); }}
            >
              <BarChart3 size={20} class="me-2" />
              {t('menu.stats')}
            </a>
          </li>
        </ul>
        <ul class="navbar-nav ms-auto">
          <li class="nav-item">
            <a 
              class={`nav-link ${currentPage === 'settings' ? 'active' : ''}`}
              href="#"
              onClick={(e) => { e.preventDefault(); handleNavigate('settings'); }}
            >
              <Settings size={20} class="me-2" />
              {t('menu.settings')}
            </a>
          </li>
          <li class="nav-item">
            <a 
              class={`nav-link ${currentPage === 'about' ? 'active' : ''}`}
              href="#"
              onClick={(e) => { e.preventDefault(); handleNavigate('about'); }}
            >
              <Info size={20} class="me-2" />
              À propos
            </a>
          </li>
        </ul>
        </div>
      </div>
    </nav>
  );
}
