// Icônes lucide : un jeu courant inclus dans le bundle principal, le catalogue complet chargé à la demande
// (chunk séparé, mis en cache par le service worker) pour la popup de choix et les icônes rares.
import { shallowRef, type Component } from 'vue';
import {
  Terminal, Play, Database, HardDrive, Cloud, CloudSun, Mail, Server, Shield, Rocket, Wrench, Bell, Camera, Download, Upload,
  RefreshCw, Trash2, Archive, Home, Zap, FileText, Globe, Cpu, Bot, AlertTriangle, Calendar, Clock, Folder, Image, Music, Video,
  Wifi, Lock, Key, Package, Printer, Thermometer, Lightbulb, Tv, Smartphone, Film, BookOpen, Coffee, Heart, Star, Sun, Moon, Leaf,
} from 'lucide-vue-next';

export const COMMON_ICONS: Record<string, Component> = {
  terminal: Terminal, play: Play, database: Database, 'hard-drive': HardDrive, cloud: Cloud, 'cloud-sun': CloudSun, mail: Mail,
  server: Server, shield: Shield, rocket: Rocket, wrench: Wrench, bell: Bell, camera: Camera, download: Download, upload: Upload,
  'refresh-cw': RefreshCw, 'trash-2': Trash2, archive: Archive, home: Home, zap: Zap, 'file-text': FileText, globe: Globe, cpu: Cpu,
  bot: Bot, 'alert-triangle': AlertTriangle, calendar: Calendar, clock: Clock, folder: Folder, image: Image, music: Music, video: Video,
  wifi: Wifi, lock: Lock, key: Key, package: Package, printer: Printer, thermometer: Thermometer, lightbulb: Lightbulb, tv: Tv,
  smartphone: Smartphone, film: Film, 'book-open': BookOpen, coffee: Coffee, heart: Heart, star: Star, sun: Sun, moon: Moon, leaf: Leaf,
};

/** Catalogue complet : nom kebab-case → composant. Rempli après `loadAllIcons()`. */
export const allIcons = shallowRef<Record<string, Component> | null>(null);
let loading: Promise<Record<string, Component>> | null = null;

const NOT_ICONS = new Set(['Icon', 'createLucideIcon', 'default']);
const toKebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase();

export function loadAllIcons(): Promise<Record<string, Component>> {
  if (allIcons.value) return Promise.resolve(allIcons.value);
  if (!loading) {
    loading = import('lucide-vue-next').then((mod) => {
      const out: Record<string, Component> = {};
      for (const [key, value] of Object.entries(mod)) {
        // On garde les composants canoniques : PascalCase, sans suffixe « Icon » ni préfixe « Lucide » (alias).
        if (NOT_ICONS.has(key) || !/^[A-Z][A-Za-z0-9]*$/.test(key) || key.endsWith('Icon') || key.startsWith('Lucide')) continue;
        if (typeof value !== 'function' && typeof value !== 'object') continue;
        out[toKebab(key)] = value as Component;
      }
      allIcons.value = out;
      return out;
    });
  }
  return loading;
}

/** Composant pour un nom : jeu courant d'abord, sinon catalogue complet s'il est chargé (déclenche son chargement). */
export function resolveIcon(name: string | undefined): Component | null {
  const n = name || 'terminal';
  if (COMMON_ICONS[n]) return COMMON_ICONS[n];
  if (allIcons.value) return allIcons.value[n] ?? null;
  void loadAllIcons();
  return null;
}
