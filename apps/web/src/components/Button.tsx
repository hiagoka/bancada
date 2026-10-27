import type { ComponentProps } from 'react';
import { Link, type LinkProps } from 'react-router';

type Variant = 'primary' | 'secondary';

const classes = (variant: Variant, className?: string): string =>
  ['btn', variant === 'secondary' ? 'btn--secondary' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

// Retângulo sem raio, texto maiúsculo em negrito. Primário: tape com texto ink.
export function Button({
  variant = 'primary',
  className,
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: Variant }) {
  return <button type={type} className={classes(variant, className)} {...props} />;
}

export function ButtonLink({
  variant = 'primary',
  className,
  ...props
}: LinkProps & { variant?: Variant }) {
  return <Link className={classes(variant, className)} {...props} />;
}
