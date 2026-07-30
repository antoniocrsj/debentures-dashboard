export default function SearchField({ wrapClassName = '', className = '', ...props }) {
  const wrapClass = `search-wrap${wrapClassName ? ` ${wrapClassName}` : ''}`
  const inputClass = `search-input${className ? ` ${className}` : ''}`

  return (
    <div className={wrapClass}>
      <span className="search-icon" aria-hidden="true">🔍</span>
      <input type="search" className={inputClass} {...props} />
    </div>
  )
}
