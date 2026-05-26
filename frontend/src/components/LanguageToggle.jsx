import React from 'react'
import { languages } from '../lib/i18n'

export default function LanguageToggle({ lang, setLang, t, compact = false }) {
  return (
    <div className={`lang-toggle ${compact ? 'compact' : ''}`} aria-label={t('language')}>
      {languages.map((item) => (
        <button
          key={item.code}
          className={lang === item.code ? 'active' : ''}
          onClick={() => setLang(item.code)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
