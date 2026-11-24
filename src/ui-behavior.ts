export function createOpenOnce(open: () => void, schedule: (callback: () => void, delay: number) => unknown = window.setTimeout.bind(window)): (event: Pick<Event, 'preventDefault' | 'stopPropagation'>) => void {
  let pending = false;
  return (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (pending) return;
    pending = true;
    open();
    schedule(() => { pending = false; }, 450);
  };
}

export function isCardEnter(key: string, target: EventTarget | null, card: EventTarget): boolean {
  return key === 'Enter' && target === card;
}

export function visibleTags(tags: string[], maximum = 3): { visible: string[]; remaining: number } {
  const visible = tags.slice(0, Math.max(0, maximum));
  return { visible, remaining: Math.max(0, tags.length - visible.length) };
}

export function navigationCurrentAttribute(active: boolean): 'page' | 'false' {
  return active ? 'page' : 'false';
}

export function favoriteButtonAccessibility(title: string, favorite: boolean): { label: string; pressed: string } {
  return { label: favorite ? `Remove ${title} from favorites` : `Add ${title} to favorites`, pressed: String(favorite) };
}

export function faviconInitials(title: string, domain: string): string {
  const generic = new Set(['the', 'a', 'an', 'official', 'home', 'welcome', 'documentation', 'docs', 'website']);
  const titleIdentity = title.trim().split(/\s+/).find((word) => !generic.has(word.toLowerCase().replace(/[^a-z]/g, '')));
  const labels = domain.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  const genericSubdomains = new Set(['www', 'docs', 'doc', 'developer', 'developers', 'support', 'help', 'learn', 'learning', 'blog', 'api', 'status']);
  while (labels.length > 2 && genericSubdomains.has(labels[0])) labels.shift();
  const hostIdentity = labels[0];
  const knownInitials: Record<string, string> = { github: 'GH', gitlab: 'GL', youtube: 'YT', wikipedia: 'WK' };
  if (!titleIdentity && hostIdentity && knownInitials[hostIdentity]) return knownInitials[hostIdentity];
  return (titleIdentity || hostIdentity || '↗').slice(0, 2).toUpperCase();
}
