import { IThemeRGB } from '../types';

/**
 * Dark theme
 * RGB values extracted from the existing dark mode CSS variables
 */
export const darkTheme: IThemeRGB = {
  // Text colors
  'rgb-text-primary': '236 236 236', // #ececec (gray-100)
  'rgb-text-secondary': '205 205 205', // #cdcdcd (gray-300)
  'rgb-text-secondary-alt': '153 150 150', // #999696 (gray-400)
  'rgb-text-tertiary': '89 89 89', // #595959 (gray-500)
  'rgb-text-warning': '245 158 11', // #f59e0b (amber-500)

  // Ring colors (not defined in dark mode, using default)
  'rgb-ring-primary': '255 95 5', // #ff5f05 (Illini Orange)

  // Header colors
  'rgb-header-primary': '22 47 85', // #162f55
  'rgb-header-hover': '29 58 101', // #1d3a65
  'rgb-header-button-hover': '29 58 101', // #1d3a65

  // Surface colors
  'rgb-surface-active': '36 63 104', // #243f68
  'rgb-surface-active-alt': '29 58 101', // #1d3a65
  'rgb-surface-hover': '34 58 94', // #223a5e
  'rgb-surface-hover-alt': '43 71 112', // #2b4770
  'rgb-surface-primary': '0 0 0', // #000
  'rgb-surface-primary-alt': '5 5 5', // #050505
  'rgb-surface-primary-contrast': '17 17 17', // #111111
  'rgb-surface-secondary': '10 10 10', // #0a0a0a
  'rgb-surface-secondary-alt': '17 17 17', // #111111
  'rgb-surface-tertiary': '26 26 26', // #1a1a1a
  'rgb-surface-tertiary-alt': '17 17 17', // #111111
  'rgb-surface-dialog': '5 5 5', // #050505
  'rgb-surface-submit': '200 65 19', // #c84113 (deep Illini Orange: white text 4.97:1)
  'rgb-surface-submit-hover': '168 54 15', // #a8360f
  'rgb-surface-destructive': '153 27 27', // #991b1b (red-800)
  'rgb-surface-destructive-hover': '127 29 29', // #7f1d1d (red-900)
  'rgb-surface-chat': '0 0 0', // #000

  // Border colors
  'rgb-border-light': '37 70 111', // #25466f
  'rgb-border-medium': '49 82 123', // #31527b
  'rgb-border-medium-alt': '49 82 123', // #31527b
  'rgb-border-heavy': '255 138 69', // #ff8a45
  'rgb-border-xheavy': '153 150 150', // #999696 (gray-400)

  // Brand colors
  'rgb-brand-purple': '255 95 5', // #ff5f05 (Illini Orange)

  // Presentation
  'rgb-presentation': '0 0 0', // #000

  // Utility colors (mapped to existing colors for backwards compatibility)
  'rgb-background': '33 33 33', // Same as surface-primary
  'rgb-foreground': '255 255 255', // Same as text-primary
  'rgb-primary': '255 95 5', // #ff5f05 (Illini Orange)
  'rgb-primary-foreground': '255 255 255', // Same as surface-primary-contrast
  'rgb-secondary': '42 42 42', // Same as surface-secondary
  'rgb-secondary-foreground': '193 193 193', // Same as text-secondary
  'rgb-muted': '56 56 56', // Same as surface-tertiary
  'rgb-muted-foreground': '140 140 140', // Same as text-tertiary
  'rgb-accent': '19 41 75', // #13294b (Illini Blue)
  'rgb-accent-foreground': '255 255 255', // Same as text-primary
  'rgb-destructive-foreground': '255 255 255', // Same as text-primary
  'rgb-border': '82 82 82', // Same as border-medium
  'rgb-input': '66 66 66', // Same as border-light
  'rgb-ring': '255 255 255', // Same as ring-primary
  'rgb-card': '42 42 42', // Same as surface-secondary
  'rgb-card-foreground': '255 255 255', // Same as text-primary
};
