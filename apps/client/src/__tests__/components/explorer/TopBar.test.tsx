import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TopBar from '@/components/explorer/TopBar';

const weatherMocks = vi.hoisted(() => ({
  useWeather: vi.fn(),
  geocodeWeatherCity: vi.fn(),
  setWeatherLocation: vi.fn(),
}));

vi.mock('@/hooks/use-weather', () => ({
  useWeather: weatherMocks.useWeather,
}));

vi.mock('@/lib/weather-geocoding', () => ({
  geocodeWeatherCity: weatherMocks.geocodeWeatherCity,
}));

vi.mock('@/lib/weather-location', () => ({
  setWeatherLocation: weatherMocks.setWeatherLocation,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isMaximized: vi.fn(() => Promise.resolve(false)),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    startDragging: vi.fn(),
    onResized: vi.fn(() => Promise.resolve(() => {})),
  }),
}));

vi.mock('@/lib/constants', () => ({
  ROOT_PATH: 'C:\\',
  isWindows: true,
  PATH_SEPARATOR: '\\',
}));

describe('TopBar', () => {
  const mockProps = {
    leftSidebarCollapsed: false,
    setLeftSidebarCollapsed: vi.fn(),
    onSplitRight: vi.fn(),
    onSplitDown: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    weatherMocks.useWeather.mockReturnValue({
      report: {
        latitude: 31.2304,
        longitude: 121.4737,
        temperature: 21,
        apparent_temperature: 20,
        humidity: 64,
        weather_code: 2,
        is_day: true,
        wind_speed: 12,
        wind_direction: 210,
        updated_at: 0,
        daily: [],
      },
      loading: false,
      error: null,
      city: 'Shanghai',
    });
    weatherMocks.geocodeWeatherCity.mockResolvedValue([]);
  });

  describe('Basic Rendering', () => {
    it('renders the application title', () => {
      render(<TopBar {...mockProps} />);
      expect(screen.getByText('Wisp')).toBeInTheDocument();
      expect(screen.queryByText('File Space')).not.toBeInTheDocument();
    });

    it('renders the sidebar toggle button', () => {
      render(<TopBar {...mockProps} />);
      expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toBeInTheDocument();
    });
  });

  describe('Sidebar Toggle', () => {
    it('calls setLeftSidebarCollapsed when toggle button is clicked', () => {
      render(<TopBar {...mockProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
      expect(mockProps.setLeftSidebarCollapsed).toHaveBeenCalledWith(true);
    });
  });

  describe('Weather City', () => {
    it('renders weather as plain titlebar text and opens the inline editor', () => {
      render(<TopBar {...mockProps} />);

      const trigger = screen.getByRole('button', {
        name: 'Edit weather city, currently Shanghai',
      });
      expect(trigger).not.toHaveClass('wisp-weather-pill');
      expect(screen.getByText('21°')).toBeInTheDocument();
      expect(screen.getByText('Partly cloudy · Shanghai')).toBeInTheDocument();

      fireEvent.click(trigger);
      const input = screen.getByRole('textbox', { name: 'Enter a weather city' });
      expect(input).toHaveValue('Shanghai');
      expect(input).toHaveFocus();
    });

    it('resolves and atomically saves a city from the inline editor', async () => {
      weatherMocks.geocodeWeatherCity.mockResolvedValue([
        {
          name: 'Beijing',
          country: 'China',
          admin1: 'Beijing',
          latitude: 39.9042,
          longitude: 116.4074,
        },
      ]);
      render(<TopBar {...mockProps} />);

      fireEvent.click(
        screen.getByRole('button', { name: 'Edit weather city, currently Shanghai' }),
      );
      const input = screen.getByRole('textbox', { name: 'Enter a weather city' });
      fireEvent.change(input, { target: { value: ' Beijing ' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(weatherMocks.geocodeWeatherCity).toHaveBeenCalledWith('Beijing');
        expect(weatherMocks.setWeatherLocation).toHaveBeenCalledWith({
          city: 'Beijing',
          latitude: 39.9042,
          longitude: 116.4074,
        });
      });
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Edit weather city, currently Shanghai' }),
        ).toHaveFocus();
      });
    });

    it('keeps the editor open when the city cannot be resolved and cancels with Escape', async () => {
      render(<TopBar {...mockProps} />);

      fireEvent.click(
        screen.getByRole('button', { name: 'Edit weather city, currently Shanghai' }),
      );
      const input = screen.getByRole('textbox', { name: 'Enter a weather city' });
      fireEvent.change(input, { target: { value: 'Unknown place' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(await screen.findByRole('alert')).toHaveTextContent('City not found');
      expect(input).toBeInTheDocument();
      await waitFor(() => expect(input).toHaveFocus());
      fireEvent.keyDown(input, { key: 'Escape' });
      await waitFor(() => {
        expect(
          screen.queryByRole('textbox', { name: 'Enter a weather city' }),
        ).not.toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: 'Edit weather city, currently Shanghai' }),
        ).toHaveFocus();
      });
      expect(weatherMocks.setWeatherLocation).not.toHaveBeenCalled();
    });
  });

  describe('Navigation Controls', () => {
    // Navigation moved to each pane's address bar (NavigationBar), right
    // next to the file window it acts on — the top bar no longer hosts it.
    it('does not render navigation buttons', () => {
      render(<TopBar {...mockProps} />);
      expect(screen.queryByTitle('Go back in history')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Go forward in history')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Go up one level')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Refresh')).not.toBeInTheDocument();
    });
  });

  describe('Tabs', () => {
    // Tabs live in each split pane's own tab bar (PaneTabBar); the title bar
    // no longer duplicates them.
    it('does not render a tab strip or new-tab button', () => {
      render(<TopBar {...mockProps} />);
      expect(screen.queryByTitle('New tab (Ctrl+T)')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'New tab' })).not.toBeInTheDocument();
    });
  });

  describe('Split Controls', () => {
    it('calls onSplitRight when split right button is clicked', () => {
      render(<TopBar {...mockProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Split right' }));
      expect(mockProps.onSplitRight).toHaveBeenCalled();
    });

    it('calls onSplitDown when split down button is clicked', () => {
      render(<TopBar {...mockProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Split down' }));
      expect(mockProps.onSplitDown).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('handles missing optional props', () => {
      const minimalProps = {
        leftSidebarCollapsed: false,
        setLeftSidebarCollapsed: vi.fn(),
      };
      expect(() => render(<TopBar {...minimalProps} />)).not.toThrow();
    });
  });
});
