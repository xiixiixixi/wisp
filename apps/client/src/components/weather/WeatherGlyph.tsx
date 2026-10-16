import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Moon,
  Sun,
} from 'lucide-react';
import { describeWeatherCode } from '@/lib/weather';

/** Lucide glyph for a WMO weather code, day/night aware. */
const WeatherGlyph = ({
  code,
  isDay,
  size = 16,
  className,
}: {
  code: number;
  isDay: boolean;
  size?: number;
  className?: string;
}) => {
  const { kind } = describeWeatherCode(code);
  const props = { size, className, 'aria-hidden': true as const };
  switch (kind) {
    case 'clear':
      return isDay ? <Sun {...props} /> : <Moon {...props} />;
    case 'partly':
      return isDay ? <CloudSun {...props} /> : <CloudMoon {...props} />;
    case 'cloudy':
    case 'overcast':
      return <Cloud {...props} />;
    case 'fog':
      return <CloudFog {...props} />;
    case 'drizzle':
      return <CloudDrizzle {...props} />;
    case 'rain':
      return <CloudRain {...props} />;
    case 'snow':
      return <CloudSnow {...props} />;
    case 'storm':
      return <CloudLightning {...props} />;
  }
};

export default WeatherGlyph;
