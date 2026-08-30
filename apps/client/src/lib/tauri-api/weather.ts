import { transport } from '../transport';

export interface WeatherDailyEntry {
  date: string;
  weather_code: number;
  temp_max: number;
  temp_min: number;
  precipitation_probability: number;
  sunrise: string;
  sunset: string;
}

export interface WeatherReport {
  latitude: number;
  longitude: number;
  temperature: number;
  apparent_temperature: number;
  humidity: number;
  weather_code: number;
  is_day: boolean;
  wind_speed: number;
  wind_direction: number;
  updated_at: number;
  daily: WeatherDailyEntry[];
}

export interface GeoPlace {
  name: string;
  country: string;
  admin1: string;
  latitude: number;
  longitude: number;
}

export const getWeather = async (latitude: number, longitude: number): Promise<WeatherReport> =>
  await transport('get_weather', { latitude, longitude });

export const geocodeCity = async (name: string): Promise<GeoPlace[]> =>
  await transport('geocode_city', { name });
