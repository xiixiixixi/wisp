import { isBrowserDemoMode } from '@/lib/browser-demo-files';
import { TauriAPI, type GeoPlace } from '@/lib/tauri-api';

type DemoPlace = Omit<GeoPlace, 'name'>;

const DEMO_PLACES: Record<string, DemoPlace> = {
  shanghai: { country: '中国', admin1: '上海', latitude: 31.2304, longitude: 121.4737 },
  beijing: { country: '中国', admin1: '北京', latitude: 39.9042, longitude: 116.4074 },
  guangzhou: { country: '中国', admin1: '广东', latitude: 23.1291, longitude: 113.2644 },
  shenzhen: { country: '中国', admin1: '广东', latitude: 22.5431, longitude: 114.0579 },
  hangzhou: { country: '中国', admin1: '浙江', latitude: 30.2741, longitude: 120.1551 },
  chengdu: { country: '中国', admin1: '四川', latitude: 30.5728, longitude: 104.0668 },
  wuhan: { country: '中国', admin1: '湖北', latitude: 30.5928, longitude: 114.3055 },
  nanjing: { country: '中国', admin1: '江苏', latitude: 32.0603, longitude: 118.7969 },
  xian: { country: '中国', admin1: '陕西', latitude: 34.3416, longitude: 108.9398 },
  chongqing: { country: '中国', admin1: '重庆', latitude: 29.563, longitude: 106.5516 },
  shenyang: { country: '中国', admin1: '辽宁', latitude: 41.8057, longitude: 123.4315 },
  tokyo: { country: '日本', admin1: '东京', latitude: 35.6762, longitude: 139.6503 },
  seoul: { country: '韩国', admin1: '首尔', latitude: 37.5665, longitude: 126.978 },
  singapore: { country: '新加坡', admin1: '', latitude: 1.3521, longitude: 103.8198 },
  london: { country: '英国', admin1: '英格兰', latitude: 51.5072, longitude: -0.1276 },
  paris: { country: '法国', admin1: '法兰西岛', latitude: 48.8566, longitude: 2.3522 },
  newyork: { country: '美国', admin1: '纽约州', latitude: 40.7128, longitude: -74.006 },
  sanfrancisco: { country: '美国', admin1: '加利福尼亚', latitude: 37.7749, longitude: -122.4194 },
  sydney: { country: '澳大利亚', admin1: '新南威尔士', latitude: -33.8688, longitude: 151.2093 },
};

const DEMO_ALIASES: Record<string, keyof typeof DEMO_PLACES> = {
  上海: 'shanghai',
  北京: 'beijing',
  广州: 'guangzhou',
  廣州: 'guangzhou',
  深圳: 'shenzhen',
  杭州: 'hangzhou',
  成都: 'chengdu',
  武汉: 'wuhan',
  武漢: 'wuhan',
  南京: 'nanjing',
  西安: 'xian',
  "xi'an": 'xian',
  重庆: 'chongqing',
  重慶: 'chongqing',
  沈阳: 'shenyang',
  沈陽: 'shenyang',
  东京: 'tokyo',
  東京: 'tokyo',
  首尔: 'seoul',
  首爾: 'seoul',
  新加坡: 'singapore',
  伦敦: 'london',
  倫敦: 'london',
  巴黎: 'paris',
  纽约: 'newyork',
  紐約: 'newyork',
  'new york': 'newyork',
  旧金山: 'sanfrancisco',
  舊金山: 'sanfrancisco',
  'san francisco': 'sanfrancisco',
  悉尼: 'sydney',
};

const normalizeCityQuery = (name: string) => name.trim().toLocaleLowerCase().replace(/\s+/g, ' ');

/** Resolve a city through the native/backend geocoder, with an offline demo catalogue. */
export async function geocodeWeatherCity(name: string): Promise<GeoPlace[]> {
  const query = name.trim();
  if (!query) return [];
  if (!isBrowserDemoMode()) return TauriAPI.geocodeCity(query);

  const normalized = normalizeCityQuery(query);
  const placeKey = DEMO_ALIASES[normalized] ?? normalized.replaceAll(' ', '');
  const place = DEMO_PLACES[placeKey];
  return place ? [{ name: query, ...place }] : [];
}
