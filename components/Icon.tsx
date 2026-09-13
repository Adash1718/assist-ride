import Svg, { Path, Circle } from 'react-native-svg';

type IconProps = { size?: number; color?: string };

const stroke = { fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function ChevronLeftIcon({ size = 20, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M15 18l-6-6 6-6" stroke={color} {...stroke} />
    </Svg>
  );
}

export function ChevronRightIcon({ size = 20, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M9 18l6-6-6-6" stroke={color} {...stroke} />
    </Svg>
  );
}

export function CameraIcon({ size = 22, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 8h3l2-3h6l2 3h3v11H4z" stroke={color} {...stroke} />
      <Circle cx="12" cy="13.5" r="3.5" stroke={color} {...stroke} />
    </Svg>
  );
}

export function PhoneIcon({ size = 20, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 9 9 0 0 0 2.8.45 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.3a1 1 0 0 1 1 1 9 9 0 0 0 .45 2.8 1 1 0 0 1-.25 1z"
        stroke={color}
        {...stroke}
      />
    </Svg>
  );
}

export function MapPinIcon({ size = 20, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" stroke={color} {...stroke} />
      <Circle cx="12" cy="10" r="2.5" stroke={color} {...stroke} />
    </Svg>
  );
}

export function ClockIcon({ size = 18, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="9" stroke={color} {...stroke} />
      <Path d="M12 7v5l3.5 2" stroke={color} {...stroke} />
    </Svg>
  );
}

export function CarIcon({ size = 22, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 16V11l2-5h12l2 5v5" stroke={color} {...stroke} />
      <Path d="M4 16h16" stroke={color} {...stroke} />
      <Circle cx="8" cy="17.5" r="1.6" stroke={color} {...stroke} />
      <Circle cx="16" cy="17.5" r="1.6" stroke={color} {...stroke} />
    </Svg>
  );
}

export function StarIcon({ size = 18, color = '#D97748', filled = true }: IconProps & { filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.2-5.4 3.2 1.3-6-4.6-4.1 6.1-.6z"
        fill={filled ? color : 'none'}
        stroke={color}
        strokeWidth={filled ? 0 : 1.5}
      />
    </Svg>
  );
}

export function CheckIcon({ size = 16, color = '#2E7A63' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 12l5 5L20 6" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export function PlusIcon({ size = 18, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 4v16M4 12h16" stroke={color} {...stroke} />
    </Svg>
  );
}

export function MinusIcon({ size = 14, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 12h16" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
    </Svg>
  );
}

export function UsersIcon({ size = 20, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="9" cy="8" r="3" stroke={color} {...stroke} />
      <Path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke={color} {...stroke} />
      <Circle cx="17" cy="9" r="2.4" stroke={color} {...stroke} />
      <Path d="M15.5 14.3c2.6.4 4.5 2.6 4.5 5.7" stroke={color} {...stroke} />
    </Svg>
  );
}

export function ShieldIcon({ size = 18, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" stroke={color} {...stroke} />
      <Path d="M9.5 12l1.8 1.8L15 10" stroke={color} {...stroke} />
    </Svg>
  );
}

export function AlertCircleIcon({ size = 18, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="9" stroke={color} {...stroke} />
      <Path d="M12 8v5" stroke={color} {...stroke} />
      <Path d="M12 16h.01" stroke={color} strokeWidth={2.6} strokeLinecap="round" />
    </Svg>
  );
}

export function HelpCircleIcon({ size = 18, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="9" stroke={color} {...stroke} />
      <Path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7" stroke={color} {...stroke} />
      <Path d="M12 17h.01" stroke={color} {...stroke} />
    </Svg>
  );
}

export function PencilIcon({ size = 16, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 20l4-1 11-11-3-3L5 16z" stroke={color} {...stroke} />
    </Svg>
  );
}

export function MessageIcon({ size = 18, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 5h16v11H8l-4 4z" stroke={color} {...stroke} />
    </Svg>
  );
}

export function CalendarIcon({ size = 18, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 9h16M8 4v3M16 4v3" stroke={color} {...stroke} />
      <Path d="M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" stroke={color} {...stroke} />
    </Svg>
  );
}

export function ScaleIcon({ size = 20, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 3v18M7 7h10M4 7l3-3 3 3M17 7l3-3 3 3" stroke={color} {...stroke} />
      <Path d="M4 7l-2 5a3 3 0 0 0 6 0l-2-5M20 7l-2 5a3 3 0 0 0 6 0l-2-5" stroke={color} {...stroke} />
    </Svg>
  );
}

export function LogOutIcon({ size = 18, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" stroke={color} {...stroke} />
      <Path d="M10 8l-4 4 4 4" stroke={color} {...stroke} />
      <Path d="M14 12H4" stroke={color} {...stroke} />
    </Svg>
  );
}

export function CloseIcon({ size = 18, color = '#232838' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 6l12 12M18 6L6 18" stroke={color} {...stroke} />
    </Svg>
  );
}
