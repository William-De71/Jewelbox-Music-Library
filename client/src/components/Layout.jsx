import { useState, useEffect } from 'preact/hooks';
import { useI18n } from '../config/i18n/index.jsx';
import { Header } from './Header.jsx';
import { TopMenu } from './TopMenu.jsx';
import { PlayerBar } from './PlayerBar.jsx';
import { PlayerView } from './PlayerView.jsx';
import { ArrowUp } from 'lucide-preact';

export function Layout({ children, navigate, currentPage }) {
  const { t } = useI18n();
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('jewelbox-theme');
    if (saved === null) {
      return true; // Default to dark
    }
    return saved === 'dark';
  });
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const theme = isDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-bs-theme', theme);
    localStorage.setItem('jewelbox-theme', theme);
  }, [isDark]);

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const toggleTheme = () => {
    setIsDark(!isDark);
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div class="layout-horizontal">
      <Header onThemeToggle={toggleTheme} isDark={isDark} navigate={navigate} />
      <TopMenu currentPage={currentPage} navigate={navigate} />
      <main class="main-content">
        {children}
      </main>
      <PlayerBar />
      <PlayerView navigate={navigate} />
      {showScrollTop && (
        <button
          class="btn btn-primary btn-scroll-top position-fixed bottom-0 end-0 m-4 rounded-circle shadow"
          style={{ width: 48, height: 48, zIndex: 1000 }}
          onClick={scrollToTop}
          title={t('common.scrollToTop')}
        >
          <ArrowUp size={20} />
        </button>
      )}
    </div>
  );
}
