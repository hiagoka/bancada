import { NavLink, type NavLinkProps } from 'react-router';

// Link de navegação com o sublinhado animado do D25 (aria-current="page" mantém o sublinhado).
export function AppLink({
  className,
  ...props
}: Omit<NavLinkProps, 'className'> & { className?: string }) {
  return <NavLink {...props} className={['link', className].filter(Boolean).join(' ')} />;
}
