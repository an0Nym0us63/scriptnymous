// Suggestions de dépendances : d'après le code (imports Python, require/import Node, commandes bash)
// et d'après un journal d'échec (module ou commande introuvable). Heuristique, jamais appliquée sans l'utilisateur.

export interface DepSuggestion {
  kind: 'pip' | 'npm' | 'apt';
  package: string;
  /** Ce qui a motivé la suggestion : nom du module ou de la commande. */
  reason: string;
  /** true si la suggestion vient d'une erreur observée dans un journal (plus fiable). */
  fromError: boolean;
}

// Modules Python dont le nom diffère du paquet pip.
const PIP_ALIASES: Record<string, string> = {
  PIL: 'pillow', cv2: 'opencv-python-headless', yaml: 'pyyaml', bs4: 'beautifulsoup4', sklearn: 'scikit-learn', skimage: 'scikit-image',
  Crypto: 'pycryptodome', dateutil: 'python-dateutil', dotenv: 'python-dotenv', jwt: 'pyjwt', serial: 'pyserial', usb: 'pyusb',
  magic: 'python-magic', gi: 'pygobject', wx: 'wxpython', zmq: 'pyzmq', OpenSSL: 'pyopenssl', nacl: 'pynacl', ldap: 'python-ldap',
  MySQLdb: 'mysqlclient', psycopg2: 'psycopg2-binary', telegram: 'python-telegram-bot', discord: 'discord.py', git: 'gitpython',
  docx: 'python-docx', pptx: 'python-pptx', fitz: 'pymupdf', exifread: 'exifread', piexif: 'piexif', mutagen: 'mutagen',
  paho: 'paho-mqtt', websocket: 'websocket-client', attr: 'attrs', googleapiclient: 'google-api-python-client', bluetooth: 'pybluez',
  Levenshtein: 'python-levenshtein', markdown: 'markdown', xmltodict: 'xmltodict', tz: 'pytz', pytz: 'pytz', tzlocal: 'tzlocal',
};

// Bibliothèque standard Python (noms de premier niveau les plus courants).
const PY_STDLIB = new Set(
  `abc argparse array ast asyncio atexit base64 binascii bisect builtins bz2 calendar cgi cmath cmd codecs collections colorsys
  concurrent configparser contextlib copy csv ctypes dataclasses datetime decimal difflib dis email enum errno faulthandler fcntl
  filecmp fileinput fnmatch fractions ftplib functools gc getopt getpass gettext glob grp gzip hashlib heapq hmac html http imaplib
  importlib inspect io ipaddress itertools json keyword linecache locale logging lzma mailbox math mimetypes mmap multiprocessing
  netrc numbers operator optparse os pathlib pdb pickle pkgutil platform plistlib poplib posix pprint profile pstats pty pwd py_compile
  queue quopri random re readline reprlib resource runpy sched secrets select selectors shelve shlex shutil signal site smtplib
  socket socketserver sqlite3 ssl stat statistics string stringprep struct subprocess sys sysconfig syslog tarfile tempfile termios
  textwrap threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty types typing unicodedata unittest
  urllib uuid venv warnings wave weakref webbrowser xml xmlrpc zipfile zipimport zlib zoneinfo __future__ typing_extensions`
    .split(/\s+/)
    .filter(Boolean),
);

// Modules intégrés de Node.
const NODE_BUILTINS = new Set(
  `assert async_hooks buffer child_process cluster console constants crypto dgram diagnostics_channel dns domain events fs http http2
  https inspector module net os path perf_hooks process punycode querystring readline repl stream string_decoder sys timers tls
  trace_events tty url util v8 vm wasi worker_threads zlib test sqlite`.split(/\s+/).filter(Boolean),
);

// Commandes déjà présentes dans l'image (socle) : jamais suggérées.
const BASE_COMMANDS = new Set(
  `bash sh cat ls cp mv rm mkdir rmdir touch chmod chown ln echo printf test true false sleep date tee head tail sort uniq wc cut tr
  sed awk grep egrep fgrep find xargs basename dirname realpath readlink env export set unset read seq tar gzip gunzip bzip2 xz unzip
  zip curl wget jq git rsync ssh scp sftp ssh-keygen python3 python pip pip3 node npm npx uv tee stat du df ps kill pkill pgrep nohup
  timeout watch which type command hostname whoami id uname sync nproc free uptime ping openssl md5sum sha256sum sha1sum base64
  diff cmp patch tr comm join paste fold nl od hexdump strings file mktemp install gosu sudo apt-get dpkg
  ffmpeg ffprobe ffplay convert magick identify mogrify exiftool sqlite3 7z 7za zip mediainfo rclone smbclient dig nslookup host nc`.split(/\s+/).filter(Boolean),
);

// Commande → paquet apt (Debian).
const APT_COMMANDS: Record<string, string> = {
  ffmpeg: 'ffmpeg', ffprobe: 'ffmpeg', convert: 'imagemagick', magick: 'imagemagick', identify: 'imagemagick', mogrify: 'imagemagick',
  exiftool: 'libimage-exiftool-perl', exiv2: 'exiv2', jpegoptim: 'jpegoptim', optipng: 'optipng', pngquant: 'pngquant',
  sqlite3: 'sqlite3', mysql: 'default-mysql-client', mysqldump: 'default-mysql-client', psql: 'postgresql-client', pg_dump: 'postgresql-client',
  mongodump: 'mongodb-database-tools', 'redis-cli': 'redis-tools', '7z': 'p7zip-full', '7za': 'p7zip-full', unrar: 'unrar-free', zstd: 'zstd',
  pdftotext: 'poppler-utils', pdftoppm: 'poppler-utils', pdfinfo: 'poppler-utils', qpdf: 'qpdf', gs: 'ghostscript', tesseract: 'tesseract-ocr',
  mkvmerge: 'mkvtoolnix', mkvextract: 'mkvtoolnix', 'yt-dlp': 'yt-dlp', HandBrakeCLI: 'handbrake-cli', mediainfo: 'mediainfo',
  rclone: 'rclone', restic: 'restic', borg: 'borgbackup', duplicity: 'duplicity', rsnapshot: 'rsnapshot', smbclient: 'smbclient',
  mosquitto_pub: 'mosquitto-clients', mosquitto_sub: 'mosquitto-clients', nmap: 'nmap', dig: 'dnsutils', nslookup: 'dnsutils',
  host: 'dnsutils', traceroute: 'traceroute', nc: 'netcat-openbsd', socat: 'socat', iperf3: 'iperf3', mtr: 'mtr-tiny', tcpdump: 'tcpdump',
  htop: 'htop', iotop: 'iotop', lsof: 'lsof', tmux: 'tmux', screen: 'screen', vim: 'vim', nano: 'nano', bc: 'bc', dc: 'bc',
  pv: 'pv', parallel: 'parallel', tree: 'tree', ncdu: 'ncdu', rename: 'rename', dos2unix: 'dos2unix', xmlstarlet: 'xmlstarlet',
  yq: 'yq', htpasswd: 'apache2-utils', certbot: 'certbot', docker: 'docker.io', mail: 'mailutils', sendmail: 'msmtp', msmtp: 'msmtp',
  gpg: 'gnupg', age: 'age', sops: 'sops', pandoc: 'pandoc', wkhtmltopdf: 'wkhtmltopdf', chromium: 'chromium', 'xvfb-run': 'xvfb',
  pip3: 'python3-pip', perl: 'perl', php: 'php-cli', ruby: 'ruby', java: 'default-jre-headless', go: 'golang-go', make: 'make', gcc: 'gcc',
  lftp: 'lftp', ncftp: 'ncftp', mutt: 'mutt', speedtest: 'speedtest-cli', 'speedtest-cli': 'speedtest-cli', nfs: 'nfs-common', mount: 'mount',
  fdupes: 'fdupes', rdfind: 'rdfind', sshpass: 'sshpass', expect: 'expect', dialog: 'dialog', whiptail: 'whiptail', figlet: 'figlet',
  'avahi-browse': 'avahi-utils', bluetoothctl: 'bluez', hcitool: 'bluez', i2cdetect: 'i2c-tools', gpio: 'wiringpi', vcgencmd: 'libraspberrypi-bin',
  ifconfig: 'net-tools', netstat: 'net-tools', route: 'net-tools', arp: 'net-tools', ip: 'iproute2', ss: 'iproute2', ethtool: 'ethtool',
  wakeonlan: 'wakeonlan', etherwake: 'etherwake', smartctl: 'smartmontools', hdparm: 'hdparm', lsblk: 'util-linux', blkid: 'util-linux',
  inotifywait: 'inotify-tools', entr: 'entr', fswatch: 'fswatch', logrotate: 'logrotate', cron: 'cron', at: 'at', ntpdate: 'ntpdate',
};

function pyModules(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/^\s*(?:from\s+([A-Za-z_][\w]*)|import\s+([A-Za-z_][\w]*(?:\s*,\s*[A-Za-z_][\w]*)*))/gm)) {
    if (m[1]) out.add(m[1]);
    if (m[2]) for (const part of m[2].split(',')) out.add(part.trim().split('.')[0]);
  }
  return [...out];
}

function nodeModules(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/(?:require\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
    // Paquet scopé : @scope/nom ; sinon premier segment.
    out.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
  }
  return [...out];
}

function shellCommands(code: string): string[] {
  const out = new Set<string>();
  for (const rawLine of code.split('\n')) {
    const line = rawLine.replace(/#.*$/, '');
    // Découpe sur les séparateurs de commandes, puis premier mot de chaque segment (en sautant les affectations VAR=…).
    for (const seg of line.split(/\|\||&&|;|\||\$\(|`|\(/)) {
      const words = seg.trim().split(/\s+/).filter(Boolean);
      let i = 0;
      while (i < words.length && /^[A-Za-z_][\w]*=/.test(words[i])) i++;
      const w = words[i];
      if (!w) continue;
      const cmd = w.replace(/^["']|["']$/g, '').split('/').pop()!;
      if (/^[A-Za-z0-9_.+-]+$/.test(cmd)) out.add(cmd);
      // sudo/time/nohup/env précèdent la vraie commande.
      if (['sudo', 'time', 'nohup', 'env', 'exec', 'command', 'xargs', 'timeout', 'nice', 'ionice'].includes(cmd) && words[i + 1]) {
        const next = words[i + 1].split('/').pop()!;
        if (/^[A-Za-z0-9_.+-]+$/.test(next)) out.add(next);
      }
    }
  }
  return [...out];
}

/** Suggestions d'après le code d'un script. */
export function suggestFromCode(interpreter: string | undefined, code: string): DepSuggestion[] {
  const out: DepSuggestion[] = [];
  const seen = new Set<string>();
  const push = (s: DepSuggestion) => {
    const k = `${s.kind}:${s.package}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  };
  if (interpreter === 'python3') {
    for (const m of pyModules(code)) {
      if (PY_STDLIB.has(m) || m.startsWith('_')) continue;
      push({ kind: 'pip', package: PIP_ALIASES[m] ?? m.toLowerCase().replace(/_/g, '-'), reason: m, fromError: false });
    }
  } else if (interpreter === 'node') {
    for (const m of nodeModules(code)) if (!NODE_BUILTINS.has(m)) push({ kind: 'npm', package: m, reason: m, fromError: false });
  } else {
    for (const c of shellCommands(code)) {
      if (BASE_COMMANDS.has(c)) continue;
      if (APT_COMMANDS[c]) push({ kind: 'apt', package: APT_COMMANDS[c], reason: c, fromError: false });
    }
  }
  return out;
}

/** Suggestions d'après un journal d'échec (plus fiables : l'erreur a été observée). */
export function suggestFromLog(log: string): DepSuggestion[] {
  const out: DepSuggestion[] = [];
  const seen = new Set<string>();
  const push = (s: DepSuggestion) => {
    const k = `${s.kind}:${s.package}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  };
  for (const m of log.matchAll(/(?:ModuleNotFoundError|ImportError): No module named '?([A-Za-z_][\w]*)/g)) {
    const mod = m[1];
    if (!PY_STDLIB.has(mod)) push({ kind: 'pip', package: PIP_ALIASES[mod] ?? mod.toLowerCase().replace(/_/g, '-'), reason: mod, fromError: true });
  }
  for (const m of log.matchAll(/Cannot find (?:module|package) '((?:@[\w.-]+\/)?[\w.-]+)[^']*'/g)) {
    const mod = m[1];
    if (!NODE_BUILTINS.has(mod) && !mod.startsWith('.') && !mod.startsWith('/')) push({ kind: 'npm', package: mod, reason: mod, fromError: true });
  }
  for (const m of log.matchAll(/(?:^|\n)[^\n]*?(?:: ([A-Za-z0-9_.+-]+): (?:command not found|not found)|command not found: ([A-Za-z0-9_.+-]+)|No such file or directory: '?([A-Za-z0-9_.+-]+)'?)/g)) {
    const cmd = (m[1] ?? m[2] ?? m[3] ?? '').split('/').pop()!;
    if (!cmd || BASE_COMMANDS.has(cmd)) continue;
    if (APT_COMMANDS[cmd]) push({ kind: 'apt', package: APT_COMMANDS[cmd], reason: cmd, fromError: true });
  }
  return out;
}
