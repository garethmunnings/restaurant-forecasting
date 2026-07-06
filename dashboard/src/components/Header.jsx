export default function Header() {
  const handleLogoClick = (e) => {
    e.preventDefault();
    window.location.reload();
  };

  return (
    <header className="header">
      <a href="/" onClick={handleLogoClick} className="header-logo">
        <img src={`${import.meta.env.BASE_URL}spur-logo.svg`} alt="Spur" />
      </a>
      <h1 className="header-title">Sales & Forecasting</h1>
    </header>
  );
}
