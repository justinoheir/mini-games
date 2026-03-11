'use client';
import { createContext, useContext } from 'react';
import { BrandTheme, DEFAULT_THEME } from './brands';

export const ThemeContext = createContext<BrandTheme>(DEFAULT_THEME);
export const useTheme = () => useContext(ThemeContext);
