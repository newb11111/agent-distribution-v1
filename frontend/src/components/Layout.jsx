import React, { useState } from 'react'
import LanguageToggle from './LanguageToggle'

export default function Layout({ children, lang, setLang, t, title, subtitle, right, navTabs = [], activeTab = '', onTabChange }) {
  const [topMenuOpen, setTopMenuOpen] = useState(false)
  const selectNav = (item) => {
    onTabChange?.(item)
    setTopMenuOpen(false)
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <div className="brand">{t('appName')}</div>
          {title && <h1>{title}</h1>}
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="top-actions">
          {right}
          <LanguageToggle lang={lang} setLang={setLang} t={t} />
        </div>
        <div className="top-mobile-controls">
          <LanguageToggle lang={lang} setLang={setLang} t={t} compact />
          <button className="top-menu-button" type="button" onClick={() => setTopMenuOpen(true)}>☰</button>
        </div>
        {topMenuOpen && (
          <div className="drawer-backdrop top-menu-backdrop" onClick={() => setTopMenuOpen(false)}>
            <aside className="side-drawer top-side-drawer" onClick={(e) => e.stopPropagation()}>
              <div className="drawer-head">
                <strong>{t('menu')}</strong>
                <button type="button" onClick={() => setTopMenuOpen(false)}>×</button>
              </div>
              <div className="top-menu-content" onClick={() => setTopMenuOpen(false)}>
                {right}
              </div>
              {navTabs.length > 0 && (
                <div className="drawer-list combined-nav-list">
                  {navTabs.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={activeTab === item ? 'active' : ''}
                      onClick={() => selectNav(item)}
                    >
                      {t(item === 'adminUsers' ? 'adminUsers' : item)}
                    </button>
                  ))}
                </div>
              )}
            </aside>
          </div>
        )}
      </header>
      <main>{children}</main>
    </div>
  )
}
