export interface ParsedUA {
  browser: string;
  os: string;
  device: 'desktop' | 'mobile' | 'tablet';
}

/** Lightweight user agent parser using regex. No heavy dependencies. */
export function parseUA(ua: string): ParsedUA {
  return {
    browser: parseBrowser(ua),
    os: parseOS(ua),
    device: parseDevice(ua),
  };
}

function parseBrowser(ua: string): string {
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return 'Opera';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/SamsungBrowser\//i.test(ua)) return 'Samsung Browser';
  if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) return 'Safari';
  if (/MSIE|Trident/i.test(ua)) return 'IE';
  return 'Other';
}

function parseOS(ua: string): string {
  if (/Windows/i.test(ua)) return 'Windows';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Mac OS X|macOS/i.test(ua)) return 'macOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Linux/i.test(ua)) return 'Linux';
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  return 'Other';
}

function parseDevice(ua: string): 'desktop' | 'mobile' | 'tablet' {
  if (/iPad|tablet/i.test(ua)) return 'tablet';
  if (/Mobile|iPhone|iPod|Android.*Mobile|Opera Mini|IEMobile/i.test(ua)) return 'mobile';
  return 'desktop';
}
