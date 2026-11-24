import { chromium } from 'playwright';
import puppeteer from 'puppeteer';
export const open = (legacy?: string) => (legacy ? puppeteer.launch() : chromium.launch());
