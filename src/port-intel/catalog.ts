import type { CategoryMeta, PortCategory, PortFacts } from './types';

/** Presentation metadata for each category, used by chips and info cards. */
export const CATEGORY_META: Record<PortCategory, CategoryMeta> = {
  web: {
    label: 'Web',
    blurb: 'Serves web pages and APIs to browsers and other programs.',
  },
  'dev-server': {
    label: 'Dev Server',
    blurb: 'A development server, usually started by you while building something.',
  },
  database: {
    label: 'Database',
    blurb: 'Stores and serves application data.',
  },
  mail: {
    label: 'Mail',
    blurb: 'Sends or receives email.',
  },
  'remote-access': {
    label: 'Remote Access',
    blurb: 'Lets someone connect to or control this machine from elsewhere.',
  },
  'file-transfer': {
    label: 'File Sharing',
    blurb: 'Moves files between this machine and others.',
  },
  directory: {
    label: 'Accounts',
    blurb: 'Handles logins, user accounts, and directory lookups.',
  },
  messaging: {
    label: 'Messaging',
    blurb: 'Passes messages between applications, often a queue or event stream.',
  },
  infrastructure: {
    label: 'Infrastructure',
    blurb: 'Developer tooling: containers, clusters, metrics, and monitoring.',
  },
  system: {
    label: 'System',
    blurb: 'Part of the operating system or local network housekeeping.',
  },
};

/**
 * Curated knowledge base of commonly seen ports.
 *
 * Every entry answers three questions for a non-technical reader: what is it
 * called in plain words, what does it actually do, and is it normal to see it
 * running here. Ports absent from this table still get an explanation — see
 * `resolve.ts` for the project, process, and port-range fallbacks.
 */
export const PORT_CATALOG: Record<number, PortFacts> = {
  // ---------------------------------------------------------------- web ----
  80: {
    plainName: 'Web Traffic',
    protocol: 'HTTP',
    category: 'web',
    description:
      'The standard port for unencrypted web pages. A browser visiting an address that starts with "http://" and has no port number lands here.',
    context:
      'Normal for a local web server. Traffic on it is not encrypted, so public websites use port 443 instead.',
    aliases: ['http', 'website', 'web server'],
  },
  443: {
    plainName: 'Secure Web Traffic',
    protocol: 'HTTPS',
    category: 'web',
    description:
      'The standard port for encrypted web pages. This is what the padlock in a browser address bar refers to.',
    context: 'Normal. Everything sent over it is encrypted in transit.',
    aliases: ['https', 'ssl', 'tls', 'secure web'],
  },
  8080: {
    plainName: 'Web Traffic (Alternate)',
    protocol: 'HTTP',
    category: 'web',
    description:
      'A very common second choice for a web server, used when port 80 is taken or would need administrator rights. Popular with Java servers, proxies, and test environments.',
    context: 'Normal on a developer machine. Often a Tomcat, Jenkins, or proxy instance.',
    aliases: ['http alt', 'tomcat', 'jenkins', 'proxy'],
  },
  8443: {
    plainName: 'Secure Web (Alternate)',
    protocol: 'HTTPS',
    category: 'web',
    description:
      'The encrypted counterpart to port 8080, used when a server wants HTTPS without needing administrator privileges.',
    context: 'Normal on a developer machine running a local HTTPS server.',
    aliases: ['https alt'],
  },
  8008: {
    plainName: 'Web Traffic (Alternate)',
    protocol: 'HTTP',
    category: 'web',
    description:
      'Another fallback web port, used by some appliances, chat servers, and casting devices.',
    context: 'Uncommon but harmless on a developer machine.',
    aliases: ['http alt'],
  },

  // --------------------------------------------------------- dev servers ----
  3000: {
    plainName: 'Development Server',
    protocol: 'React / Next.js',
    category: 'dev-server',
    description:
      'The default port for React, Next.js, and many Node.js apps in development. Grafana dashboards also use it. This is what "npm start" usually opens.',
    context: 'Expected while you are working on a project. Safe to stop when you are done.',
    aliases: ['react', 'next', 'nextjs', 'node', 'grafana', 'npm start'],
  },
  3001: {
    plainName: 'Development Server',
    protocol: 'React / Node.js',
    category: 'dev-server',
    description:
      'The automatic second choice when port 3000 is already busy. Often a second app, or an API running alongside a frontend.',
    context: 'Expected when you have two development servers open at once.',
    aliases: ['react', 'node'],
  },
  3030: {
    plainName: 'Development Server',
    protocol: 'Node.js',
    category: 'dev-server',
    description:
      'A common alternative development port for Node.js tools such as Slidev and Meteor, and for hand-rolled API servers.',
    context: 'Expected while a project is running.',
    aliases: ['node', 'meteor', 'slidev'],
  },
  3333: {
    plainName: 'Development Server',
    protocol: 'Node.js / Nx',
    category: 'dev-server',
    description:
      'A frequently chosen development port for API servers, AdonisJS, and Nx workspaces.',
    context: 'Expected while a project is running.',
    aliases: ['node', 'nx', 'adonis', 'api'],
  },
  4000: {
    plainName: 'Development Server',
    protocol: 'Node.js / Phoenix',
    category: 'dev-server',
    description:
      'A common development port for Node.js APIs, GraphQL servers, Phoenix (Elixir) apps, and Jekyll sites.',
    context: 'Expected while a project is running.',
    aliases: ['node', 'graphql', 'phoenix', 'jekyll'],
  },
  4173: {
    plainName: 'Preview Server',
    protocol: 'Vite Preview',
    category: 'dev-server',
    description:
      'Vite serving a finished production build locally so you can check it before shipping. Started by "vite preview".',
    context: 'Expected right after a build. Safe to stop.',
    aliases: ['vite', 'preview', 'build'],
  },
  4200: {
    plainName: 'Development Server',
    protocol: 'Angular',
    category: 'dev-server',
    description: 'The default port for the Angular development server, opened by "ng serve".',
    context: 'Expected while you are working on an Angular project.',
    aliases: ['angular', 'ng serve'],
  },
  4321: {
    plainName: 'Development Server',
    protocol: 'Astro',
    category: 'dev-server',
    description: 'The default port for the Astro development server.',
    context: 'Expected while you are working on an Astro site.',
    aliases: ['astro'],
  },
  5000: {
    plainName: 'Development Server',
    protocol: 'Flask / ASP.NET',
    category: 'dev-server',
    description:
      'The default for Python Flask apps and for ASP.NET Core. On macOS this port is also taken by the built-in AirPlay Receiver.',
    context:
      'Expected while a project is running. On a Mac, an unexpected listener here is usually AirPlay rather than your own code.',
    aliases: ['flask', 'python', 'aspnet', 'dotnet', 'airplay'],
  },
  5173: {
    plainName: 'Development Server',
    protocol: 'Vite',
    category: 'dev-server',
    description:
      'The default port for Vite, the build tool behind modern React, Vue, and Svelte projects. It reloads the page as you edit.',
    context: 'Expected while you are working on a project. Safe to stop when you are done.',
    aliases: ['vite', 'vue', 'svelte', 'npm run dev'],
  },
  5174: {
    plainName: 'Development Server',
    protocol: 'Vite',
    category: 'dev-server',
    description: 'The automatic second choice when Vite finds port 5173 already busy.',
    context: 'Expected when you have two Vite projects open at once.',
    aliases: ['vite'],
  },
  5555: {
    plainName: 'Database Browser',
    protocol: 'Prisma Studio',
    category: 'dev-server',
    description:
      'Prisma Studio, a web page for browsing and editing the contents of your database during development.',
    context: 'Expected if you ran "prisma studio". Safe to stop.',
    aliases: ['prisma', 'studio', 'database ui'],
  },
  6006: {
    plainName: 'Component Workshop',
    protocol: 'Storybook',
    category: 'dev-server',
    description:
      'Storybook, a private web page listing your interface components so you can view and test them one at a time.',
    context: 'Expected while you are working on UI components. Safe to stop.',
    aliases: ['storybook', 'components', 'ui'],
  },
  7000: {
    plainName: 'Development Server',
    protocol: 'Various',
    category: 'dev-server',
    description:
      'A general-purpose development port. On macOS it is also used by the AirPlay Receiver built into the system.',
    context:
      'On a Mac, a listener here that you did not start is usually AirPlay, which can be turned off in System Settings.',
    aliases: ['airplay', 'dev'],
  },
  8000: {
    plainName: 'Development Server',
    protocol: 'Django / Python',
    category: 'dev-server',
    description:
      'The default for the Django development server and for "python -m http.server". Also a common choice for PHP and Laravel.',
    context: 'Expected while a project is running. Safe to stop when you are done.',
    aliases: ['django', 'python', 'laravel', 'php', 'http.server'],
  },
  8001: {
    plainName: 'Development Server',
    protocol: 'Django / Python',
    category: 'dev-server',
    description: 'The usual second choice when port 8000 is already taken.',
    context: 'Expected when you have two Python projects open at once.',
    aliases: ['django', 'python'],
  },
  8081: {
    plainName: 'Development Server',
    protocol: 'Metro / React Native',
    category: 'dev-server',
    description:
      'The Metro bundler for React Native, which builds and serves JavaScript to a phone or emulator. Also a common alternate web port.',
    context: 'Expected while you are working on a mobile app.',
    aliases: ['metro', 'react native', 'expo', 'mobile'],
  },
  8888: {
    plainName: 'Notebook Server',
    protocol: 'Jupyter',
    category: 'dev-server',
    description:
      'Jupyter Notebook or JupyterLab, a browser-based environment for running Python code in small blocks.',
    context:
      'Expected if you started a notebook. Anyone who can reach this port can run code on this machine, so it should stay local.',
    aliases: ['jupyter', 'notebook', 'python', 'lab'],
  },
  9000: {
    plainName: 'Application Backend',
    protocol: 'PHP-FPM / SonarQube',
    category: 'dev-server',
    description:
      'Most often PHP-FPM, the process that runs PHP code behind a web server. Also used by SonarQube, MinIO, and Portainer.',
    context: 'Normal on a PHP development setup.',
    aliases: ['php', 'php-fpm', 'sonarqube', 'minio', 'portainer'],
  },
  9229: {
    plainName: 'Debugger',
    protocol: 'Node.js Inspector',
    category: 'dev-server',
    description:
      'The Node.js debugger. Your editor or Chrome DevTools connects here to pause code and inspect variables.',
    context:
      'Expected when you started a program with "--inspect". Anyone who can reach it can run code, so it should stay on this machine only.',
    aliases: ['node', 'debug', 'inspector', 'devtools'],
  },
  19000: {
    plainName: 'Mobile Dev Server',
    protocol: 'Expo',
    category: 'dev-server',
    description:
      'The Expo development server for React Native apps, which your phone connects to while you test.',
    context: 'Expected while you are working on an Expo app.',
    aliases: ['expo', 'react native', 'mobile'],
  },
  19006: {
    plainName: 'Mobile Dev Server (Web)',
    protocol: 'Expo Web',
    category: 'dev-server',
    description: 'Expo serving the web version of a React Native app in your browser.',
    context: 'Expected while you are working on an Expo app.',
    aliases: ['expo', 'web'],
  },
  24678: {
    plainName: 'Live Reload Channel',
    protocol: 'Vite HMR',
    category: 'dev-server',
    description:
      'The background connection Vite uses to push code changes straight into your browser without a full page refresh.',
    context: 'Expected alongside a Vite dev server. It stops when the dev server stops.',
    aliases: ['vite', 'hmr', 'hot reload', 'websocket'],
  },
  35729: {
    plainName: 'Live Reload Channel',
    protocol: 'LiveReload',
    category: 'dev-server',
    description:
      'The LiveReload service, which refreshes your browser automatically whenever a file changes.',
    context: 'Expected alongside a development server.',
    aliases: ['livereload', 'hot reload', 'watch'],
  },
  1420: {
    plainName: 'Desktop App Dev Server',
    protocol: 'Tauri',
    category: 'dev-server',
    description:
      'The development server Tauri uses to load the interface of a desktop app. PortPal itself uses this port while being developed.',
    context: 'Expected while you are working on a Tauri app.',
    aliases: ['tauri', 'desktop', 'rust'],
  },

  // ----------------------------------------------------------- databases ----
  5432: {
    plainName: 'PostgreSQL Database',
    protocol: 'PostgreSQL',
    category: 'database',
    description:
      'PostgreSQL, a widely used database. Applications connect here to read and write their data.',
    context:
      'Normal if you installed Postgres or run it in a container. Stopping it will disconnect anything using it.',
    aliases: ['postgres', 'postgresql', 'psql', 'sql', 'database'],
  },
  5433: {
    plainName: 'PostgreSQL Database',
    protocol: 'PostgreSQL',
    category: 'database',
    description:
      'A second PostgreSQL instance, commonly a different version or a container running next to the main one.',
    context: 'Normal when you run more than one Postgres at a time.',
    aliases: ['postgres', 'postgresql'],
  },
  3306: {
    plainName: 'MySQL Database',
    protocol: 'MySQL / MariaDB',
    category: 'database',
    description:
      'MySQL or MariaDB, a widely used database. Applications connect here to read and write their data.',
    context: 'Normal if you installed MySQL or run it in a container.',
    aliases: ['mysql', 'mariadb', 'sql', 'database'],
  },
  6379: {
    plainName: 'Redis Cache',
    protocol: 'Redis',
    category: 'database',
    description:
      'Redis, a very fast in-memory store used for caching, sessions, and job queues. What it holds is usually temporary.',
    context:
      'Normal in most modern app setups. Redis has no password by default, so it should not be reachable from outside this machine.',
    aliases: ['redis', 'cache', 'session', 'queue'],
  },
  27017: {
    plainName: 'MongoDB Database',
    protocol: 'MongoDB',
    category: 'database',
    description:
      'MongoDB, a document database that stores data as flexible JSON-like records rather than fixed tables.',
    context:
      'Normal if your project uses MongoDB. It should stay local unless you deliberately opened it up.',
    aliases: ['mongo', 'mongodb', 'nosql', 'database'],
  },
  27018: {
    plainName: 'MongoDB Database',
    protocol: 'MongoDB',
    category: 'database',
    description: 'A second MongoDB instance, often part of a replica set or a container.',
    context: 'Normal when running a MongoDB cluster locally.',
    aliases: ['mongo', 'mongodb'],
  },
  1433: {
    plainName: 'SQL Server Database',
    protocol: 'Microsoft SQL Server',
    category: 'database',
    description: 'Microsoft SQL Server, the database behind many Windows and .NET applications.',
    context: 'Normal on a Windows development machine with SQL Server installed.',
    aliases: ['mssql', 'sqlserver', 'sql', 'database'],
  },
  1521: {
    plainName: 'Oracle Database',
    protocol: 'Oracle',
    category: 'database',
    description: 'Oracle Database, common in large enterprise systems.',
    context: 'Normal if you work with Oracle. Rare on a personal machine.',
    aliases: ['oracle', 'database'],
  },
  9042: {
    plainName: 'Cassandra Database',
    protocol: 'Apache Cassandra',
    category: 'database',
    description:
      'Apache Cassandra, a database built to spread very large amounts of data across many machines.',
    context: 'Normal if your project uses Cassandra or ScyllaDB.',
    aliases: ['cassandra', 'scylla', 'cql', 'database'],
  },
  5984: {
    plainName: 'CouchDB Database',
    protocol: 'Apache CouchDB',
    category: 'database',
    description: 'Apache CouchDB, a document database designed to sync easily between devices.',
    context: 'Normal if your project uses CouchDB.',
    aliases: ['couchdb', 'couch', 'database'],
  },
  7687: {
    plainName: 'Neo4j Database',
    protocol: 'Neo4j Bolt',
    category: 'database',
    description:
      'Neo4j, a graph database that stores information as connected nodes and relationships.',
    context: 'Normal if your project uses Neo4j.',
    aliases: ['neo4j', 'graph', 'bolt', 'database'],
  },
  8086: {
    plainName: 'InfluxDB Database',
    protocol: 'InfluxDB',
    category: 'database',
    description:
      'InfluxDB, a database specialised in time-stamped measurements such as metrics and sensor readings.',
    context: 'Normal in monitoring and IoT setups.',
    aliases: ['influx', 'influxdb', 'timeseries', 'metrics'],
  },
  11211: {
    plainName: 'Memcached Cache',
    protocol: 'Memcached',
    category: 'database',
    description: 'Memcached, a simple in-memory cache used to make applications respond faster.',
    context:
      'Normal in a caching setup. It has no authentication, so it should never be reachable from the internet.',
    aliases: ['memcache', 'memcached', 'cache'],
  },
  26257: {
    plainName: 'CockroachDB Database',
    protocol: 'CockroachDB',
    category: 'database',
    description: 'CockroachDB, a distributed database that speaks the same language as PostgreSQL.',
    context: 'Normal if your project uses CockroachDB.',
    aliases: ['cockroach', 'cockroachdb', 'database'],
  },
  8123: {
    plainName: 'ClickHouse Database',
    protocol: 'ClickHouse',
    category: 'database',
    description: 'ClickHouse, a database built for fast analytics over very large tables.',
    context: 'Normal in analytics and reporting setups.',
    aliases: ['clickhouse', 'analytics', 'olap'],
  },
  9200: {
    plainName: 'Search Engine',
    protocol: 'Elasticsearch / OpenSearch',
    category: 'database',
    description:
      'Elasticsearch or OpenSearch, which indexes text and log data so it can be searched quickly.',
    context:
      'Normal in search or logging setups. Older versions have no password by default, so it should stay local.',
    aliases: ['elastic', 'elasticsearch', 'opensearch', 'search', 'logs'],
  },
  9300: {
    plainName: 'Search Engine (Cluster)',
    protocol: 'Elasticsearch Transport',
    category: 'database',
    description:
      'The private channel Elasticsearch servers use to talk to each other. Applications use port 9200 instead.',
    context: 'Normal alongside Elasticsearch.',
    aliases: ['elastic', 'elasticsearch', 'cluster'],
  },

  // ---------------------------------------------------------------- mail ----
  25: {
    plainName: 'Outgoing Mail',
    protocol: 'SMTP',
    category: 'mail',
    description: 'The original port for sending email between mail servers.',
    context:
      'Unusual on a personal machine. Most internet providers block it, and modern mail apps use port 587 instead.',
    aliases: ['smtp', 'email', 'mail'],
  },
  465: {
    plainName: 'Outgoing Mail (Secure)',
    protocol: 'SMTPS',
    category: 'mail',
    description: 'Sending email over an encrypted connection.',
    context: 'Normal for a configured mail client or mail server.',
    aliases: ['smtps', 'email', 'mail'],
  },
  587: {
    plainName: 'Outgoing Mail (Submission)',
    protocol: 'SMTP Submission',
    category: 'mail',
    description:
      'The standard modern port an email program uses to hand a message to its mail server.',
    context: 'Normal for a configured mail client or mail server.',
    aliases: ['smtp', 'submission', 'email', 'mail'],
  },
  110: {
    plainName: 'Incoming Mail',
    protocol: 'POP3',
    category: 'mail',
    description:
      'An older way of downloading email, which usually removes messages from the server once they are fetched.',
    context: 'Uncommon today, and unencrypted. The secure version is port 995.',
    aliases: ['pop', 'pop3', 'email', 'mail'],
  },
  143: {
    plainName: 'Incoming Mail',
    protocol: 'IMAP',
    category: 'mail',
    description:
      'Reading email that stays stored on the mail server, so it remains in sync across your devices.',
    context: 'Unencrypted. The secure version is port 993.',
    aliases: ['imap', 'email', 'mail'],
  },
  993: {
    plainName: 'Incoming Mail (Secure)',
    protocol: 'IMAPS',
    category: 'mail',
    description: 'The encrypted version of IMAP, used by essentially every modern mail app.',
    context: 'Normal for a configured mail client.',
    aliases: ['imaps', 'imap', 'email', 'mail'],
  },
  995: {
    plainName: 'Incoming Mail (Secure)',
    protocol: 'POP3S',
    category: 'mail',
    description: 'The encrypted version of POP3 mail downloads.',
    context: 'Normal for a configured mail client.',
    aliases: ['pop3s', 'email', 'mail'],
  },
  1025: {
    plainName: 'Test Mail Catcher',
    protocol: 'MailHog / Mailpit SMTP',
    category: 'mail',
    description:
      'A fake mail server for development. It accepts the email your app sends and holds it, instead of delivering it to real people.',
    context: 'Expected in a development setup. Nothing sent here reaches the outside world.',
    aliases: ['mailhog', 'mailpit', 'mailcatcher', 'smtp', 'test'],
  },
  8025: {
    plainName: 'Test Mail Inbox',
    protocol: 'MailHog / Mailpit UI',
    category: 'mail',
    description: 'The web page where you read the email captured by a development mail catcher.',
    context: 'Expected in a development setup.',
    aliases: ['mailhog', 'mailpit', 'inbox', 'ui'],
  },

  // ------------------------------------------------------- remote access ----
  22: {
    plainName: 'Secure Remote Login',
    protocol: 'SSH',
    category: 'remote-access',
    description:
      'SSH, the standard encrypted way to log into a machine and run commands on it from somewhere else. It also carries Git traffic and secure file copies.',
    context:
      'Normal on servers and on developer machines with remote access switched on. Worth checking if you did not enable it.',
    aliases: ['ssh', 'sftp', 'scp', 'terminal', 'remote', 'git'],
  },
  23: {
    plainName: 'Remote Login (Unencrypted)',
    protocol: 'Telnet',
    category: 'remote-access',
    description:
      'An obsolete way of logging into a machine remotely. It sends passwords as readable text.',
    context:
      'Should not normally be running. If you did not enable it deliberately, it is worth turning off.',
    aliases: ['telnet', 'remote'],
  },
  3389: {
    plainName: 'Remote Desktop',
    protocol: 'RDP',
    category: 'remote-access',
    description:
      'Windows Remote Desktop, which lets someone see and control this computer as if they were sitting at it.',
    context:
      'Normal on managed work machines. If you did not switch Remote Desktop on yourself, it is worth checking.',
    aliases: ['rdp', 'remote desktop', 'windows', 'mstsc'],
  },
  5900: {
    plainName: 'Screen Sharing',
    protocol: 'VNC',
    category: 'remote-access',
    description: 'VNC screen sharing, which lets another person view and control this desktop.',
    context: 'Normal if you turned screen sharing on. Worth checking if you did not.',
    aliases: ['vnc', 'screen sharing', 'remote'],
  },
  5985: {
    plainName: 'Windows Remote Management',
    protocol: 'WinRM',
    category: 'remote-access',
    description:
      'The channel IT tools and PowerShell use to run commands on this machine remotely.',
    context: 'Normal on a company-managed Windows machine.',
    aliases: ['winrm', 'powershell', 'remote'],
  },
  5986: {
    plainName: 'Windows Remote Management (Secure)',
    protocol: 'WinRM over HTTPS',
    category: 'remote-access',
    description: 'The encrypted version of Windows Remote Management.',
    context: 'Normal on a company-managed Windows machine.',
    aliases: ['winrm', 'powershell', 'remote'],
  },

  // ------------------------------------------------------- file transfer ----
  20: {
    plainName: 'File Transfer (Data)',
    protocol: 'FTP Data',
    category: 'file-transfer',
    description:
      'The channel classic FTP uses to move the actual file contents. Port 21 carries the commands.',
    context: 'Rare today. FTP is unencrypted; SFTP over port 22 replaced it.',
    aliases: ['ftp', 'file transfer'],
  },
  21: {
    plainName: 'File Transfer',
    protocol: 'FTP',
    category: 'file-transfer',
    description:
      'The classic File Transfer Protocol, used to upload and download files from a server.',
    context:
      'Everything including the password travels unencrypted. If you did not start an FTP server on purpose, it is worth turning off.',
    aliases: ['ftp', 'file transfer', 'upload'],
  },
  69: {
    plainName: 'Simple File Transfer',
    protocol: 'TFTP',
    category: 'file-transfer',
    description:
      'A stripped-down file transfer service, mostly used to start devices up over a network.',
    context: 'Unusual on a personal machine. It has no authentication at all.',
    aliases: ['tftp', 'boot', 'pxe'],
  },
  139: {
    plainName: 'Windows File Sharing (Legacy)',
    protocol: 'NetBIOS Session',
    category: 'file-transfer',
    description: 'The older channel Windows uses to share files and printers on a local network.',
    context: 'Normal on a Windows machine in an office or home network.',
    aliases: ['netbios', 'smb', 'file sharing', 'windows'],
  },
  445: {
    plainName: 'Windows File Sharing',
    protocol: 'SMB',
    category: 'file-transfer',
    description:
      'How Windows shares folders and printers across a network. Also how network drives are reached.',
    context:
      'Normal on Windows and on any machine hosting shared folders. It should never be reachable from the internet.',
    aliases: ['smb', 'cifs', 'file sharing', 'windows', 'network drive'],
  },
  873: {
    plainName: 'File Sync',
    protocol: 'rsync',
    category: 'file-transfer',
    description: 'The rsync service, used to copy and mirror folders efficiently between machines.',
    context: 'Normal on a backup or mirror server.',
    aliases: ['rsync', 'backup', 'sync'],
  },
  2049: {
    plainName: 'Network File System',
    protocol: 'NFS',
    category: 'file-transfer',
    description: 'NFS, the standard way Unix and Linux machines share folders across a network.',
    context: 'Normal on Linux servers and network storage devices.',
    aliases: ['nfs', 'file sharing', 'mount', 'nas'],
  },

  // ----------------------------------------------------------- directory ----
  88: {
    plainName: 'Corporate Login',
    protocol: 'Kerberos',
    category: 'directory',
    description:
      'Kerberos, the ticket-based login system behind Windows domains and many corporate networks.',
    context: 'Normal on a machine joined to a company domain.',
    aliases: ['kerberos', 'login', 'domain', 'active directory'],
  },
  389: {
    plainName: 'Directory Lookup',
    protocol: 'LDAP',
    category: 'directory',
    description:
      'LDAP, the service that answers "who is this user and what are they allowed to do" for company networks.',
    context: 'Normal on a domain controller. Unencrypted; port 636 is the secure version.',
    aliases: ['ldap', 'directory', 'active directory', 'users'],
  },
  636: {
    plainName: 'Directory Lookup (Secure)',
    protocol: 'LDAPS',
    category: 'directory',
    description: 'The encrypted version of LDAP directory lookups.',
    context: 'Normal on a domain controller.',
    aliases: ['ldaps', 'ldap', 'directory'],
  },
  1812: {
    plainName: 'Network Login',
    protocol: 'RADIUS',
    category: 'directory',
    description: 'RADIUS, which checks usernames and passwords for Wi-Fi and VPN connections.',
    context: 'Normal on network equipment, unusual on a laptop.',
    aliases: ['radius', 'wifi', 'vpn', 'auth'],
  },
  1813: {
    plainName: 'Network Login (Accounting)',
    protocol: 'RADIUS Accounting',
    category: 'directory',
    description: 'The half of RADIUS that records who connected and for how long.',
    context: 'Normal on network equipment.',
    aliases: ['radius', 'accounting'],
  },

  // ----------------------------------------------------------- messaging ----
  1883: {
    plainName: 'Device Messaging',
    protocol: 'MQTT',
    category: 'messaging',
    description: 'MQTT, a lightweight messaging system used by smart-home devices and sensors.',
    context:
      'Normal if you run a home automation hub or an IoT project. Unencrypted; port 8883 is the secure version.',
    aliases: ['mqtt', 'iot', 'smart home', 'mosquitto'],
  },
  4222: {
    plainName: 'Message Broker',
    protocol: 'NATS',
    category: 'messaging',
    description:
      'NATS, a fast messaging system that lets separate services send events to each other.',
    context: 'Normal in a microservice setup.',
    aliases: ['nats', 'queue', 'events'],
  },
  5671: {
    plainName: 'Message Queue (Secure)',
    protocol: 'AMQPS',
    category: 'messaging',
    description: 'The encrypted version of the RabbitMQ message queue connection.',
    context: 'Normal alongside RabbitMQ.',
    aliases: ['rabbitmq', 'amqp', 'queue'],
  },
  5672: {
    plainName: 'Message Queue',
    protocol: 'AMQP / RabbitMQ',
    category: 'messaging',
    description:
      'RabbitMQ, which holds jobs and messages in a queue so applications can work through them in the background.',
    context: 'Normal in setups with background jobs or scheduled email.',
    aliases: ['rabbitmq', 'amqp', 'queue', 'jobs'],
  },
  15672: {
    plainName: 'Message Queue Dashboard',
    protocol: 'RabbitMQ Management',
    category: 'messaging',
    description:
      'The web dashboard for inspecting RabbitMQ queues and the messages waiting in them.',
    context: 'Normal alongside RabbitMQ. It ships with a default login, so it should stay local.',
    aliases: ['rabbitmq', 'dashboard', 'ui', 'queue'],
  },
  9092: {
    plainName: 'Event Stream',
    protocol: 'Apache Kafka',
    category: 'messaging',
    description:
      'Apache Kafka, which records a continuous stream of events that many services can read at their own pace.',
    context: 'Normal in data-heavy or microservice setups.',
    aliases: ['kafka', 'stream', 'events', 'queue'],
  },
  2181: {
    plainName: 'Cluster Coordinator',
    protocol: 'Apache ZooKeeper',
    category: 'messaging',
    description:
      'ZooKeeper, which keeps a group of servers agreeing on shared settings. It often runs next to Kafka.',
    context: 'Normal alongside Kafka or HBase.',
    aliases: ['zookeeper', 'kafka', 'cluster'],
  },
  8883: {
    plainName: 'Device Messaging (Secure)',
    protocol: 'MQTT over TLS',
    category: 'messaging',
    description: 'The encrypted version of MQTT device messaging.',
    context: 'Normal in a home automation or IoT setup.',
    aliases: ['mqtt', 'iot', 'tls'],
  },
  61616: {
    plainName: 'Message Queue',
    protocol: 'ActiveMQ',
    category: 'messaging',
    description: 'Apache ActiveMQ, a message queue common in Java applications.',
    context: 'Normal in a Java backend setup.',
    aliases: ['activemq', 'jms', 'queue', 'java'],
  },

  // ------------------------------------------------------ infrastructure ----
  2375: {
    plainName: 'Docker Control (Unencrypted)',
    protocol: 'Docker API',
    category: 'infrastructure',
    description:
      'The Docker engine accepting commands over the network without encryption. Anything that can reach it can start containers on this machine.',
    context:
      'Always switched on deliberately, never by default. It grants full control of the machine, so it should only ever be reachable locally.',
    aliases: ['docker', 'container', 'api'],
  },
  2376: {
    plainName: 'Docker Control (Secure)',
    protocol: 'Docker API over TLS',
    category: 'infrastructure',
    description:
      'The Docker engine accepting commands over an encrypted, certificate-checked connection.',
    context: 'Normal on a machine set up for remote Docker management.',
    aliases: ['docker', 'container', 'tls'],
  },
  2379: {
    plainName: 'Cluster Settings Store',
    protocol: 'etcd Client',
    category: 'infrastructure',
    description:
      'etcd, the store that holds the configuration and current state of a Kubernetes cluster.',
    context: 'Normal on a Kubernetes control-plane machine.',
    aliases: ['etcd', 'kubernetes', 'k8s', 'cluster'],
  },
  2380: {
    plainName: 'Cluster Settings Sync',
    protocol: 'etcd Peer',
    category: 'infrastructure',
    description: 'The private channel etcd servers use to stay in sync with each other.',
    context: 'Normal on a Kubernetes control-plane machine.',
    aliases: ['etcd', 'kubernetes', 'cluster'],
  },
  6443: {
    plainName: 'Kubernetes Control',
    protocol: 'Kubernetes API',
    category: 'infrastructure',
    description:
      'The Kubernetes API server, which every "kubectl" command talks to. Local clusters such as k3s and Docker Desktop use it too.',
    context: 'Normal if you run Kubernetes locally.',
    aliases: ['kubernetes', 'k8s', 'kubectl', 'k3s', 'api'],
  },
  10250: {
    plainName: 'Kubernetes Node Agent',
    protocol: 'kubelet',
    category: 'infrastructure',
    description: 'The kubelet, the agent that actually runs containers on one Kubernetes machine.',
    context: 'Normal on any Kubernetes node.',
    aliases: ['kubelet', 'kubernetes', 'k8s'],
  },
  8200: {
    plainName: 'Secret Store',
    protocol: 'HashiCorp Vault',
    category: 'infrastructure',
    description:
      'Vault, which stores passwords, API keys, and certificates and hands them out to applications that are allowed to have them.',
    context: 'Normal in a setup that manages secrets centrally.',
    aliases: ['vault', 'secrets', 'hashicorp'],
  },
  8500: {
    plainName: 'Service Registry',
    protocol: 'HashiCorp Consul',
    category: 'infrastructure',
    description:
      'Consul, which keeps track of where each service is running so the others can find it.',
    context: 'Normal in a microservice setup.',
    aliases: ['consul', 'service discovery', 'hashicorp'],
  },
  9090: {
    plainName: 'Metrics Collector',
    protocol: 'Prometheus',
    category: 'infrastructure',
    description:
      'Prometheus, which regularly collects numbers about how systems are performing and stores them for graphing.',
    context: 'Normal in a monitoring setup.',
    aliases: ['prometheus', 'metrics', 'monitoring'],
  },
  9093: {
    plainName: 'Alert Manager',
    protocol: 'Prometheus Alertmanager',
    category: 'infrastructure',
    description:
      'The component that decides when a monitoring alert should actually notify someone.',
    context: 'Normal alongside Prometheus.',
    aliases: ['alertmanager', 'prometheus', 'alerts'],
  },
  9100: {
    plainName: 'Machine Metrics',
    protocol: 'Prometheus Node Exporter',
    category: 'infrastructure',
    description:
      'Publishes this machine CPU, memory, and disk figures so a monitoring system can read them.',
    context: 'Normal on a monitored server.',
    aliases: ['node exporter', 'prometheus', 'metrics'],
  },
  3100: {
    plainName: 'Log Collector',
    protocol: 'Grafana Loki',
    category: 'infrastructure',
    description:
      'Loki, which gathers log lines from applications so they can be searched in Grafana.',
    context: 'Normal in a monitoring setup.',
    aliases: ['loki', 'logs', 'grafana'],
  },
  5601: {
    plainName: 'Log Dashboard',
    protocol: 'Kibana',
    category: 'infrastructure',
    description:
      'Kibana, the web dashboard for searching and charting data stored in Elasticsearch.',
    context: 'Normal alongside Elasticsearch.',
    aliases: ['kibana', 'elastic', 'logs', 'dashboard'],
  },
  16686: {
    plainName: 'Request Tracing UI',
    protocol: 'Jaeger',
    category: 'infrastructure',
    description:
      'Jaeger, a web page showing how a single request travelled through your services and where the time went.',
    context: 'Normal in a setup with distributed tracing.',
    aliases: ['jaeger', 'tracing', 'observability'],
  },
  9411: {
    plainName: 'Request Tracing',
    protocol: 'Zipkin',
    category: 'infrastructure',
    description: 'Zipkin, which collects timing traces showing how requests move between services.',
    context: 'Normal in a setup with distributed tracing.',
    aliases: ['zipkin', 'tracing', 'observability'],
  },
  4317: {
    plainName: 'Telemetry Intake',
    protocol: 'OpenTelemetry gRPC',
    category: 'infrastructure',
    description:
      'Where applications send their metrics, logs, and traces using the OpenTelemetry standard.',
    context: 'Normal in a modern monitoring setup.',
    aliases: ['otlp', 'opentelemetry', 'otel', 'traces'],
  },
  4318: {
    plainName: 'Telemetry Intake (HTTP)',
    protocol: 'OpenTelemetry HTTP',
    category: 'infrastructure',
    description:
      'The HTTP version of the OpenTelemetry intake, used by browser and mobile clients.',
    context: 'Normal in a modern monitoring setup.',
    aliases: ['otlp', 'opentelemetry', 'otel', 'traces'],
  },
  902: {
    plainName: 'Virtual Machine Service',
    protocol: 'VMware',
    category: 'infrastructure',
    description: 'A VMware service used to manage virtual machines running on this computer.',
    context: 'Normal if VMware is installed.',
    aliases: ['vmware', 'virtual machine', 'vm'],
  },

  // -------------------------------------------------------------- system ----
  53: {
    plainName: 'Domain Name Lookup',
    protocol: 'DNS',
    category: 'system',
    description:
      'DNS, which turns website names into the numeric addresses computers actually use. A listener here is usually a local cache or a container network.',
    context:
      'Normal on machines running Docker, a VPN, or a local DNS tool such as Pi-hole or dnsmasq.',
    aliases: ['dns', 'domain', 'resolver', 'dnsmasq', 'pihole'],
  },
  67: {
    plainName: 'Network Address Handout',
    protocol: 'DHCP Server',
    category: 'system',
    description: 'The service that hands out network addresses to devices joining a network.',
    context:
      'Normal on routers, and on a machine sharing its connection or running virtual machines.',
    aliases: ['dhcp', 'network', 'router'],
  },
  68: {
    plainName: 'Network Address Request',
    protocol: 'DHCP Client',
    category: 'system',
    description: 'The side of DHCP that asks the router for this machine network address.',
    context: 'Normal on every machine connected to a network.',
    aliases: ['dhcp', 'network'],
  },
  123: {
    plainName: 'Clock Sync',
    protocol: 'NTP',
    category: 'system',
    description:
      'Keeps this computer clock accurate by checking it against time servers on the internet.',
    context: 'Normal on every machine.',
    aliases: ['ntp', 'time', 'clock'],
  },
  135: {
    plainName: 'Windows Service Directory',
    protocol: 'MS RPC',
    category: 'system',
    description:
      'The Windows service that tells programs which port another Windows service is currently using.',
    context: 'Normal and always running on Windows. It should not be reachable from the internet.',
    aliases: ['rpc', 'windows', 'epmap'],
  },
  137: {
    plainName: 'Windows Name Lookup',
    protocol: 'NetBIOS Name Service',
    category: 'system',
    description: 'An old Windows mechanism for finding other computers by name on a local network.',
    context: 'Normal on a Windows machine in a home or office network.',
    aliases: ['netbios', 'windows', 'name'],
  },
  138: {
    plainName: 'Windows Network Announcements',
    protocol: 'NetBIOS Datagram',
    category: 'system',
    description: 'How older Windows networking broadcasts messages to other computers nearby.',
    context: 'Normal on a Windows machine in a local network.',
    aliases: ['netbios', 'windows', 'broadcast'],
  },
  161: {
    plainName: 'Device Monitoring',
    protocol: 'SNMP',
    category: 'system',
    description:
      'SNMP, used by monitoring tools to read the status of printers, switches, and servers.',
    context: 'Normal on network equipment, unusual on a laptop.',
    aliases: ['snmp', 'monitoring', 'network'],
  },
  500: {
    plainName: 'VPN Setup',
    protocol: 'IKE / IPsec',
    category: 'system',
    description: 'The negotiation step that establishes an encrypted VPN tunnel.',
    context: 'Normal if you use a VPN.',
    aliases: ['vpn', 'ipsec', 'ike'],
  },
  631: {
    plainName: 'Printing',
    protocol: 'IPP / CUPS',
    category: 'system',
    description:
      'The printing system, which manages print queues and finds printers on the network.',
    context: 'Normal on macOS and Linux, and on any machine with printers configured.',
    aliases: ['printing', 'cups', 'ipp', 'printer'],
  },
  1900: {
    plainName: 'Device Discovery',
    protocol: 'SSDP / UPnP',
    category: 'system',
    description: 'How computers find smart TVs, speakers, and other devices on the local network.',
    context: 'Normal on a home network. Media players and casting apps rely on it.',
    aliases: ['ssdp', 'upnp', 'discovery', 'cast', 'dlna'],
  },
  3702: {
    plainName: 'Device Discovery',
    protocol: 'WS-Discovery',
    category: 'system',
    description: 'How Windows finds printers and scanners on the local network.',
    context: 'Normal on Windows.',
    aliases: ['ws-discovery', 'windows', 'printer', 'discovery'],
  },
  5040: {
    plainName: 'Windows Device Sync',
    protocol: 'Connected Devices Platform',
    category: 'system',
    description:
      'A built-in Windows service that links this PC with your phone and other devices, powering features such as Nearby Sharing.',
    context: 'Normal and very common on Windows 10 and 11. Not something you started.',
    aliases: ['windows', 'cdpsvc', 'nearby sharing', 'phone link'],
  },
  5353: {
    plainName: 'Local Device Discovery',
    protocol: 'mDNS / Bonjour',
    category: 'system',
    description:
      'How devices announce themselves on a local network using ".local" names. It sits behind AirPlay, AirDrop, Chromecast, and printer discovery.',
    context: 'Normal on almost every machine. Started by the operating system, not by you.',
    aliases: ['mdns', 'bonjour', 'avahi', 'airplay', 'chromecast', 'local'],
  },
  5355: {
    plainName: 'Local Name Lookup',
    protocol: 'LLMNR',
    category: 'system',
    description: 'A Windows fallback for finding other computers by name when DNS cannot answer.',
    context: 'Normal on Windows. Many companies switch it off for security reasons.',
    aliases: ['llmnr', 'windows', 'name'],
  },
  7680: {
    plainName: 'Windows Update Sharing',
    protocol: 'Delivery Optimization',
    category: 'system',
    description:
      'Lets this PC download Windows updates from other PCs nearby instead of only from Microsoft servers.',
    context: 'Normal and very common on Windows 10 and 11. Part of Windows Update.',
    aliases: ['windows update', 'delivery optimization', 'dosvc'],
  },
};

/** Every port number the catalog knows about, ascending. */
export const CATALOG_PORTS: number[] = Object.keys(PORT_CATALOG)
  .map(Number)
  .sort((a, b) => a - b);
