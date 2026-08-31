import React, { useEffect, useState } from 'react';
import { useWeather } from '@/hooks/use-weather';
import { moonPhase, moonRender, skyScene, type SkyScene } from '@/lib/weather';
import { isWeatherSyncEnabled } from '@/lib/weather-location';

/**
 * Global weather ambience: a fixed, pointer-transparent layer painted behind
 * every glass panel. Scene gradients tint the whole workspace; rain/snow/fog
 * run as pure-CSS layers so panels' backdrop-blur refracts them. Day and
 * night are expressed purely through light — a warm弥散 sun glow, and a
 * moonlight wash whose strength follows the real lunar phase. No celestial
 * bodies are drawn.
 */
const WeatherFx = () => {
  const { report } = useWeather();
  // Weather ambience is opt-in (氛围跟随天气) — respect the settings toggle
  // live, exactly like SkySync, or the night wash veils light themes.
  const [enabled, setEnabled] = useState(isWeatherSyncEnabled());

  useEffect(() => {
    const sync = () => setEnabled(isWeatherSyncEnabled());
    window.addEventListener('wisp-settings-changed', sync);
    return () => window.removeEventListener('wisp-settings-changed', sync);
  }, []);

  const scene: SkyScene | null =
    enabled && report ? skyScene(report.weather_code, report.is_day) : null;

  // Abstract moonlight: night scenes carry a cold wash whose intensity
  // follows the real lunar phase — full-moon nights glow, new-moon nights
  // barely. The phase itself is never drawn.
  const { illuminated } = moonRender(moonPhase());
  const moonGlow = scene && scene.endsWith('night') ? 0.3 + illuminated * 0.55 : 0;

  const showSunlight = scene === 'clear-day' || scene === 'partly-day';
  const showMoonlight = scene === 'clear-night' || scene === 'partly-night';
  const showClouds =
    scene === 'partly-day' || scene === 'partly-night' || scene === 'cloudy' || scene === 'fog';
  const showRain = scene === 'rain' || scene === 'storm';
  const showSnow = scene === 'snow';
  const showFog = scene === 'fog';
  const showStorm = scene === 'storm';

  if (!scene) return null;

  return (
    <div
      className={`weather-fx weather-scene-${scene}`}
      style={{ '--moon-glow': moonGlow } as React.CSSProperties}
      aria-hidden="true"
    >
      {/* Scene tint (gradients in CSS) */}
      <div className="weather-fx-tint" />

      {/* Light only — no celestial bodies */}
      {showSunlight && <div className="weather-glow weather-glow-sun" />}
      {showMoonlight && <div className="weather-glow weather-glow-moon" />}

      {/* Drifting clouds */}
      {showClouds && (
        <>
          <div className="weather-cloud weather-cloud-a" />
          <div className="weather-cloud weather-cloud-b" />
          {scene === 'cloudy' || scene === 'fog' ? (
            <div className="weather-cloud weather-cloud-c" />
          ) : null}
        </>
      )}

      {/* Precipitation */}
      {showRain && (
        <>
          <div className="weather-precip weather-rain-a" />
          <div className="weather-precip weather-rain-b" />
        </>
      )}
      {showSnow && (
        <>
          <div className="weather-precip weather-snow-a" />
          <div className="weather-precip weather-snow-b" />
        </>
      )}
      {showFog && (
        <>
          <div className="weather-fog weather-fog-a" />
          <div className="weather-fog weather-fog-b" />
        </>
      )}
      {showStorm && <div className="weather-lightning" />}
    </div>
  );
};

export default WeatherFx;
