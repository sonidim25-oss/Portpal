import { CATEGORY_META, PORT_CATALOG } from './catalog';
import type { PortCategory, PortExplanation, PortFacts, PortLike } from './types';

/**
 * Port number ranges, as defined by IANA. Used only as a last resort, when we
 * have nothing to go on but the number itself.
 */
const WELL_KNOWN_MAX = 1023;
const REGISTERED_MAX = 49151;

/**
 * Owning-process patterns, checked in order when the port number itself is not
 * in the catalog. The first match wins, so put specific names before generic
 * runtimes: "postgres" must be tested before a bare "node" or "python".
 */
const PROCESS_HINTS: Array<{ match: RegExp; facts: PortFacts }> = [
  {
    match: /^postgres/i,
    facts: {
      plainName: 'PostgreSQL Database',
      protocol: 'PostgreSQL',
      category: 'database',
      description: 'A PostgreSQL database server, running on a port other than its usual 5432.',
      context: 'Normal for a second instance or a container with a remapped port.',
    },
  },
  {
    match: /^(mysqld|mariadbd?)/i,
    facts: {
      plainName: 'MySQL Database',
      protocol: 'MySQL / MariaDB',
      category: 'database',
      description:
        'A MySQL or MariaDB database server, running on a port other than its usual 3306.',
      context: 'Normal for a second instance or a container with a remapped port.',
    },
  },
  {
    match: /^redis/i,
    facts: {
      plainName: 'Redis Cache',
      protocol: 'Redis',
      category: 'database',
      description: 'A Redis in-memory store, running on a port other than its usual 6379.',
      context: 'Normal for a second instance or a container with a remapped port.',
    },
  },
  {
    match: /^mongod/i,
    facts: {
      plainName: 'MongoDB Database',
      protocol: 'MongoDB',
      category: 'database',
      description: 'A MongoDB database server, running on a port other than its usual 27017.',
      context: 'Normal for a second instance or a container with a remapped port.',
    },
  },
  {
    match: /^(docker|com\.docker|containerd|dockerd)/i,
    facts: {
      plainName: 'Container Port',
      protocol: 'Docker',
      category: 'infrastructure',
      description:
        'Docker is forwarding this port to a program running inside a container. The real service is whatever the container runs.',
      context: 'Normal when containers are running. Stopping the container releases the port.',
    },
  },
  {
    match: /^(nginx|apache2?|httpd|caddy|traefik|haproxy)/i,
    facts: {
      plainName: 'Web Server',
      protocol: 'HTTP Server',
      category: 'web',
      description:
        'A web server or reverse proxy handing out pages and routing requests to other services.',
      context: 'Normal on a machine hosting or proxying websites.',
    },
  },
  {
    match: /^(sshd?|openssh)/i,
    facts: {
      plainName: 'Secure Remote Login',
      protocol: 'SSH',
      category: 'remote-access',
      description: 'An SSH server accepting encrypted remote logins on a non-standard port.',
      context:
        'Moving SSH off port 22 is a common practice. Worth checking if you did not set it up.',
    },
  },
  {
    match: /^(java|javaw)/i,
    facts: {
      plainName: 'Java Application',
      protocol: 'Java',
      category: 'dev-server',
      description:
        'A program running on the Java platform. Could be a web server, a build tool, or an application server.',
      context: 'Normal on a machine doing Java development.',
    },
  },
  {
    match: /^(python|python3|py|uvicorn|gunicorn)/i,
    facts: {
      plainName: 'Python Application',
      protocol: 'Python',
      category: 'dev-server',
      description:
        'A Python program listening for connections, most often a web application or API.',
      context: 'Normal while a Python project is running.',
    },
  },
  {
    match: /^(ruby|puma|rails|unicorn)/i,
    facts: {
      plainName: 'Ruby Application',
      protocol: 'Ruby',
      category: 'dev-server',
      description: 'A Ruby program listening for connections, most often a Rails web application.',
      context: 'Normal while a Ruby project is running.',
    },
  },
  {
    match: /^(dotnet|iisexpress|w3wp)/i,
    facts: {
      plainName: '.NET Application',
      protocol: '.NET',
      category: 'dev-server',
      description:
        'A .NET program listening for connections, usually an ASP.NET web application or API.',
      context: 'Normal while a .NET project is running.',
    },
  },
  {
    match: /^(php|php-fpm|php-cgi)/i,
    facts: {
      plainName: 'PHP Application',
      protocol: 'PHP',
      category: 'dev-server',
      description:
        'A PHP program listening for connections, usually a website or the PHP-FPM worker behind one.',
      context: 'Normal while a PHP project is running.',
    },
  },
  {
    match: /^(node|bun|deno|npm|pnpm|yarn|esbuild)/i,
    facts: {
      plainName: 'Node.js Application',
      protocol: 'Node.js',
      category: 'dev-server',
      description:
        'A JavaScript program listening for connections. Usually a development server, an API, or a build tool.',
      context: 'Normal while a JavaScript project is running. Safe to stop when you are done.',
    },
  },
  {
    match: /^(svchost|lsass|services|system|wininit|spoolsv|smss|csrss)/i,
    facts: {
      plainName: 'Windows System Service',
      protocol: 'Windows',
      category: 'system',
      description:
        'A built-in Windows service. These are started by the operating system, not by you.',
      context:
        'Normal on every Windows machine. Stopping one of these can make the system unstable.',
    },
  },
  {
    match: /^(launchd|mdnsresponder|rapportd|controlce|sharingd)/i,
    facts: {
      plainName: 'macOS System Service',
      protocol: 'macOS',
      category: 'system',
      description:
        'A built-in macOS service, typically handling device discovery, sharing, or continuity features.',
      context: 'Normal on every Mac. Started by the operating system, not by you.',
    },
  },
  {
    match: /^(chrome|firefox|msedge|brave|safari|opera)/i,
    facts: {
      plainName: 'Web Browser',
      protocol: 'Browser',
      category: 'system',
      description:
        'A web browser holding a local port open, usually for an extension, a devtools connection, or media playback.',
      context: 'Normal while a browser is open.',
    },
  },
  {
    match: /^(code|codium|idea|pycharm|webstorm|rider|goland|clion|devenv)/i,
    facts: {
      plainName: 'Code Editor',
      protocol: 'IDE',
      category: 'dev-server',
      description:
        'A code editor or IDE holding a port open, typically for a language server, a debugger, or a live preview.',
      context: 'Normal while your editor is open.',
    },
  },
];

/** Ranges used when nothing else identifies the port. */
function factsFromRange(port: number): PortFacts {
  if (port <= WELL_KNOWN_MAX) {
    return {
      plainName: 'System Service',
      protocol: 'Well-Known Port',
      category: 'system',
      description:
        'A low-numbered port reserved for standard system services. Programs usually need administrator rights to use one.',
      context: 'Something on this machine is providing a standard network service here.',
    };
  }
  if (port <= REGISTERED_MAX) {
    return {
      plainName: 'Application Port',
      protocol: 'Registered Port',
      category: 'infrastructure',
      description:
        'A port in the range applications register for their own use. An installed program or a project of yours chose this number.',
      context: 'Check the owning process below to see what claimed it.',
    };
  }
  return {
    plainName: 'Temporary Port',
    protocol: 'Ephemeral Port',
    category: 'system',
    description:
      'A short-lived port the operating system handed out automatically. These are normally one end of an outgoing connection rather than a service you can visit.',
    context: 'Normal and very common. The number changes every time and is not worth remembering.',
  };
}

/** True when `protocol` adds nothing the `plainName` does not already say. */
function protocolIsRedundant(plainName: string, protocol: string): boolean {
  const name = plainName.toLowerCase();
  const proto = protocol.toLowerCase();
  return name.includes(proto) || proto.includes(name);
}

/**
 * Builds the `Port 80 (Web Traffic / HTTP)` label from the ideas backlog,
 * collapsing to `Port 5432 (PostgreSQL Database)` when spelling out the
 * protocol would just repeat the plain name.
 */
export function formatHeadline(port: number, facts: PortFacts): string {
  const suffix = protocolIsRedundant(facts.plainName, facts.protocol)
    ? facts.plainName
    : `${facts.plainName} / ${facts.protocol}`;
  return `Port ${port} (${suffix})`;
}

/**
 * Explains one detected port in plain English.
 *
 * Always returns a usable answer. The fallback chain is, in order:
 *   1. an exact hit in the curated catalog
 *   2. a project PortPal found on disk for this port
 *   3. a guess from the owning process name
 *   4. the port number range
 *
 * A detected project wins over the catalog only for ports that are *not*
 * well-known: seeing your project on 3000 should say "your project", but a
 * project that happens to sit on 443 is still web traffic.
 */
export function explainPort(port: PortLike): PortExplanation {
  const known = PORT_CATALOG[port.port];
  const projectName = port.project_name?.trim() || null;

  if (projectName && (!known || known.category === 'dev-server')) {
    const facts: PortFacts = {
      plainName: `${projectName} (Dev Server)`,
      protocol: known?.protocol ?? 'Development Server',
      category: 'dev-server',
      description: known
        ? `Your project "${projectName}" is running here. ${known.description}`
        : `Your project "${projectName}" is running a development server on this port.`,
      context: 'Expected while you are working on this project. Safe to stop when you are done.',
      aliases: known?.aliases,
    };
    return {
      ...facts,
      port: port.port,
      confidence: 'project',
      headline: formatHeadline(port.port, facts),
    };
  }

  if (known) {
    return {
      ...known,
      port: port.port,
      confidence: 'known',
      headline: formatHeadline(port.port, known),
    };
  }

  const processName = port.process_name?.trim();
  if (processName) {
    const bare = processName.replace(/\.(exe|app)$/i, '');
    const hint = PROCESS_HINTS.find((entry) => entry.match.test(bare));
    if (hint) {
      return {
        ...hint.facts,
        port: port.port,
        confidence: 'process',
        headline: formatHeadline(port.port, hint.facts),
      };
    }
  }

  const ranged = factsFromRange(port.port);
  return {
    ...ranged,
    port: port.port,
    confidence: 'range',
    headline: formatHeadline(port.port, ranged),
  };
}

/** The category description shown under the chip in the info card. */
export function categoryBlurb(category: PortCategory): string {
  return CATEGORY_META[category].blurb;
}

/** The short category label shown on the chip. */
export function categoryLabel(category: PortCategory): string {
  return CATEGORY_META[category].label;
}

/**
 * Whether a port matches a free-text query, taking the plain-English name,
 * protocol, category, and aliases into account. Lets a user find Postgres by
 * typing "database" and port 2375 by typing "docker".
 *
 * Exposed for the port list to use; wiring it into the app filter is optional.
 * See INTEGRATION.md.
 */
export function matchesPortQuery(port: PortLike, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const explanation = explainPort(port);
  return [
    String(port.port),
    explanation.plainName,
    explanation.protocol,
    categoryLabel(explanation.category),
    port.process_name ?? '',
    port.project_name ?? '',
    ...(explanation.aliases ?? []),
  ]
    .join(' ')
    .toLowerCase()
    .includes(q);
}
