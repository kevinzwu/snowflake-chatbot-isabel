-- Isabel sample dataset, step 3: synthetic data.
-- Everything here is invented. Hosts are under example.com and IPs come from the
-- RFC 5737 documentation ranges. The 42 base catalog entries use real public CVE
-- IDs with generic descriptions (3 are configuration findings with no CVE).
-- CVSS and EPSS values are illustrative.
-- Rows are derived from HASH(row number), so every run produces the same data.
-- Dates are relative to CURRENT_DATE; re-run this file to refresh them.
USE SCHEMA ISABEL_SAMPLE.SECURITY;

TRUNCATE TABLE IF EXISTS TEAMS;
TRUNCATE TABLE IF EXISTS APPLICATIONS;
TRUNCATE TABLE IF EXISTS VULNERABILITY_CATALOG;
TRUNCATE TABLE IF EXISTS HOST_VULNERABILITIES;
TRUNCATE TABLE IF EXISTS CODE_FINDINGS;

-- ---------------------------------------------------------------- TEAMS (12)
INSERT INTO TEAMS
SELECT column1, column2, column3, column4, column5, column6,
       IFF(column7 IS NULL, NULL, DATEADD(DAY, -column7, CURRENT_DATE())), column8
FROM VALUES
  ('TEAM-001', 'Platform Security',    'Infrastructure', 'Avery Chen',        'Noor Haddad',   'avery.chen@example.com',         40, 88.5),
  ('TEAM-002', 'Payments Engineering', 'Engineering',    'Jordan Ellis',      'Lena Fischer',  'jordan.ellis@example.com',       75, 91.0),
  ('TEAM-003', 'Identity Services',    'Engineering',    'Morgan Patel',      'Tomas Reyes',   'morgan.patel@example.com',       20, 94.5),
  ('TEAM-004', 'Data Platform',        'Engineering',    'Riley Okafor',      'Mei Tanaka',    'riley.okafor@example.com',      130, 72.0),
  ('TEAM-005', 'Customer Portal',      'Product',        'Casey Novak',       'Ibrahim Sesay', 'casey.novak@example.com',       210, 66.5),
  ('TEAM-006', 'Mobile Apps',          'Product',        'Taylor Brandt',     'Chloe Dubois',  'taylor.brandt@example.com',      95, 79.0),
  ('TEAM-007', 'Edge Networking',      'Infrastructure', 'Quinn Alvarez',     'Arjun Mehta',   'quinn.alvarez@example.com',      60, 84.0),
  ('TEAM-008', 'Observability',        'Infrastructure', 'Jamie Holt',        'Sofia Rossi',   'jamie.holt@example.com',        300, 58.0),
  ('TEAM-009', 'Billing Systems',      'Engineering',    'Sam Ferreira',      'Kwame Boateng', 'sam.ferreira@example.com',       15, 96.0),
  ('TEAM-010', 'Partner Integrations', 'Product',        'Drew Nakamura',     'Elena Petrova', 'drew.nakamura@example.com',     180, 69.5),
  ('TEAM-011', 'Internal Tools',       'Infrastructure', 'Parker Lindqvist',  'Hugo Martin',   'parker.lindqvist@example.com', NULL, NULL),
  ('TEAM-012', 'Media Delivery',       'Product',        'Robin Castellano',  'Aisha Rahman',  'robin.castellano@example.com', NULL, NULL);

-- --------------------------------------------------------- APPLICATIONS (40)
-- 8 name prefixes x 5 products. IDs 1001..1040, owned round-robin by the 12 teams.
INSERT INTO APPLICATIONS
WITH g AS (
  SELECT ROW_NUMBER() OVER (ORDER BY SEQ4()) AS id FROM TABLE(GENERATOR(ROWCOUNT => 40))
), b AS (
  SELECT id,
         ABS(HASH(id, 'crit')) % 100 AS r_crit,
         ABS(HASH(id, 'life')) % 100 AS r_life,
         GET(ARRAY_CONSTRUCT('Atlas','Beacon','Cobalt','Delta','Ember','Falcon','Granite','Harbor'), (id - 1) % 8)::STRING AS prefix,
         GET(ARRAY_CONSTRUCT('Portal','Gateway','Ledger','Scheduler','Analytics'), FLOOR((id - 1) / 8))::STRING AS product
  FROM g
)
SELECT 1000 + id,
       prefix || ' ' || product,
       GET(ARRAY_CONSTRUCT('Customer Experience','Platform Services','Finance','Operations','Data and Analytics'), FLOOR((id - 1) / 8))::STRING,
       CASE WHEN r_crit < 15 THEN 'Critical' WHEN r_crit < 45 THEN 'High' WHEN r_crit < 80 THEN 'Medium' ELSE 'Low' END,
       CASE WHEN r_crit < 30 THEN 'Tier 1' WHEN r_crit < 70 THEN 'Tier 2' ELSE 'Tier 3' END,
       CASE WHEN r_life < 80 THEN 'Production' WHEN r_life < 90 THEN 'Development' ELSE 'Retiring' END,
       product IN ('Portal', 'Gateway') AND r_crit % 4 <> 0,
       'TEAM-' || LPAD(((id - 1) % 12) + 1, 3, '0')
FROM b;

-- ------------------------------------------- VULNERABILITY_CATALOG (150 rows)
-- 42 hand-written entries (ids 1-42), then 108 platform variants of them (ids 43-150),
-- so some CVEs appear on several catalog entries.
INSERT INTO VULNERABILITY_CATALOG
SELECT column1, column2, column3, column4, column5, column6, column7, column8, column9::DATE, column10, column11, column12
FROM VALUES
 (1,'Apache Log4j2 JNDI Remote Code Execution','Critical','Library','CVE-2021-44228',10.0,0.9440,'Yes','2021-12-10','Log4j2 versions before 2.15.0 evaluate JNDI lookups in logged messages.','An unauthenticated attacker who can get a crafted string logged can load and run remote code.','Upgrade Log4j2 to 2.17.1 or later. As a stopgap, remove the JndiLookup class from the classpath.'),
 (2,'Spring Framework Data Binding Remote Code Execution (Spring4Shell)','Critical','Library','CVE-2022-22965',9.8,0.9430,'Yes','2022-03-31','Spring MVC and WebFlux applications on JDK 9+ can be made to modify class loader properties through data binding.','A remote attacker can write a web shell to the application server and run commands.','Upgrade Spring Framework to 5.3.18 or 5.2.20 or later.'),
 (3,'OpenSSL TLS Heartbeat Information Disclosure (Heartbleed)','High','Application','CVE-2014-0160',7.5,0.9470,'Yes','2014-04-07','The TLS heartbeat extension in OpenSSL 1.0.1 before 1.0.1g does not validate a length field.','A remote attacker can read process memory, including private keys and session data.','Upgrade OpenSSL to 1.0.1g or later, reissue certificates and rotate keys.'),
 (4,'SMBv1 Remote Code Execution (EternalBlue)','High','Operating System','CVE-2017-0144',8.1,0.9740,'Yes','2017-03-14','The SMBv1 server in several Windows versions mishandles specially crafted packets.','A remote attacker can run code on the host and spread to other systems on the network.','Apply the vendor security update and disable SMBv1.'),
 (5,'libwebp Heap Buffer Overflow','High','Library','CVE-2023-4863',8.8,0.9190,'Yes','2023-09-12','A heap buffer overflow in the WebP image decoder can be triggered by a crafted image.','Opening or processing a malicious image can lead to code execution in the host application.','Update libwebp to 1.3.2 or later and update applications that bundle it.'),
 (6,'HTTP/2 Rapid Reset Denial of Service','High','Network','CVE-2023-44487',7.5,0.9430,'Yes','2023-10-10','HTTP/2 servers can be made to consume excessive resources by repeatedly opening and cancelling streams.','A remote attacker can exhaust server capacity with a small number of connections.','Update HTTP/2 implementations, apply rate limits on stream resets, and enable DDoS mitigation.'),
 (7,'XZ Utils Backdoor in liblzma','Critical','Library','CVE-2024-3094',10.0,0.8500,'Yes','2024-03-29','Releases 5.6.0 and 5.6.1 of xz contain malicious code that interferes with sshd authentication.','A remote attacker holding a specific key can bypass authentication on affected systems.','Downgrade to xz 5.4.x or upgrade to a patched release from your distribution.'),
 (8,'OpenSSH Signal Handler Race Condition (regreSSHion)','High','Application','CVE-2024-6387',8.1,0.6700,'No','2024-07-01','A race condition in the sshd signal handler on glibc-based Linux can lead to unauthenticated code execution.','Exploitation is difficult and slow but gives a remote attacker root access.','Upgrade OpenSSH to 9.8p1 or later. Set LoginGraceTime to 0 as a mitigation.'),
 (9,'sudo Heap Overflow in sudoedit (Baron Samedit)','High','Operating System','CVE-2021-3156',7.8,0.9420,'Yes','2021-01-26','A heap-based buffer overflow in sudo before 1.9.5p2 is reachable by any local user.','A local unprivileged user can gain root.','Upgrade sudo to 1.9.5p2 or later.'),
 (10,'Linux Kernel Pipe Buffer Overwrite (Dirty Pipe)','High','Operating System','CVE-2022-0847',7.8,0.9150,'Yes','2022-03-07','A flaw in the Linux kernel pipe code lets unprivileged users overwrite data in read-only files.','A local user can escalate privileges to root.','Update the kernel to a patched version (5.16.11, 5.15.25, 5.10.102 or later).'),
 (11,'polkit pkexec Local Privilege Escalation (PwnKit)','High','Operating System','CVE-2021-4034',7.8,0.9520,'Yes','2022-01-25','pkexec mishandles an empty argument list and reads attacker-controlled environment variables.','A local user can gain root on most Linux distributions.','Install the polkit update, or remove the setuid bit from pkexec.'),
 (12,'curl SOCKS5 Heap Buffer Overflow','Critical','Library','CVE-2023-38545',9.8,0.3100,'No','2023-10-11','A slow SOCKS5 handshake with a long hostname can overflow a heap buffer in libcurl.','A malicious proxy or server can corrupt memory and may achieve code execution.','Upgrade curl and libcurl to 8.4.0 or later.'),
 (13,'OpenSSL X.509 Punycode Buffer Overflow','High','Library','CVE-2022-3602',7.5,0.1700,'No','2022-11-01','A four-byte buffer overflow occurs when parsing a crafted email address in a certificate name constraint.','A malicious certificate can crash the process and may allow code execution.','Upgrade OpenSSL 3.0.x to 3.0.7 or later.'),
 (14,'Remote Desktop Services Remote Code Execution (BlueKeep)','Critical','Operating System','CVE-2019-0708',9.8,0.9740,'Yes','2019-05-16','A pre-authentication flaw in Remote Desktop Services allows wormable remote code execution.','An unauthenticated attacker can run code through port 3389.','Apply the vendor security update, enable Network Level Authentication and restrict RDP exposure.'),
 (15,'Netlogon Elevation of Privilege (Zerologon)','Critical','Operating System','CVE-2020-1472',10.0,0.9440,'Yes','2020-08-11','The Netlogon secure channel uses a weak cryptographic construction that can be bypassed.','An attacker on the network can take over a domain controller.','Apply the vendor security update and enable enforcement mode.'),
 (16,'Print Spooler Remote Code Execution (PrintNightmare)','High','Operating System','CVE-2021-34527',8.8,0.9750,'Yes','2021-07-02','The Windows Print Spooler service improperly handles privileged file operations.','An authenticated user can run code as SYSTEM, including on domain controllers.','Apply the vendor security update. Disable the Print Spooler service where it is not needed.'),
 (17,'Apache Struts 2 Content-Type Remote Code Execution','Critical','Library','CVE-2017-5638',10.0,0.9750,'Yes','2017-03-10','The Jakarta Multipart parser in Struts 2 evaluates OGNL expressions from a crafted Content-Type header.','A remote unauthenticated attacker can run commands on the server.','Upgrade Struts to 2.3.32 or 2.5.10.1 or later.'),
 (18,'Apache Struts 2 Namespace Remote Code Execution','Critical','Library','CVE-2018-11776',9.8,0.9740,'Yes','2018-08-22','Struts 2 can evaluate OGNL expressions from an unset namespace in results or actions.','A remote attacker can run code through a crafted URL.','Upgrade Struts to 2.3.35 or 2.5.17 or later.'),
 (19,'Mail Server Pre-Authentication SSRF (ProxyLogon)','Critical','Application','CVE-2021-26855',9.8,0.9740,'Yes','2021-03-02','A server-side request forgery in an on-premises mail server lets a remote attacker authenticate as the server.','Chained with a file-write flaw, it gives remote code execution as SYSTEM.','Apply the vendor security update and review the server for web shells.'),
 (20,'Apache HTTP Server Path Traversal','High','Application','CVE-2021-41773',7.5,0.9740,'Yes','2021-10-05','Apache HTTP Server 2.4.49 does not normalize some encoded path sequences.','An attacker can read files outside the document root and, with CGI enabled, run code.','Upgrade Apache HTTP Server to 2.4.51 or later.'),
 (21,'Apache HTTP Server Path Traversal Fix Bypass','Critical','Application','CVE-2021-42013',9.8,0.9750,'Yes','2021-10-07','The fix for CVE-2021-41773 in 2.4.50 was incomplete for double-encoded sequences.','An attacker can read arbitrary files and run commands where mod_cgi is enabled.','Upgrade Apache HTTP Server to 2.4.51 or later.'),
 (22,'Confluence Server OGNL Injection','Critical','Application','CVE-2022-26134',9.8,0.9750,'Yes','2022-06-03','An OGNL injection in a wiki server allows an unauthenticated user to run code through a crafted URL.','A remote attacker can run commands and take over the server.','Upgrade to a fixed release and restrict internet access to the service.'),
 (23,'File Transfer Application SQL Injection','Critical','Application','CVE-2023-34362',9.8,0.9440,'Yes','2023-06-02','A SQL injection in the web interface of a managed file transfer product allows unauthenticated access to the database.','Attackers can read and exfiltrate files and run commands as the application.','Apply the vendor patch and review logs for unexpected web shells and data access.'),
 (24,'Mail Client Elevation of Privilege via Reminder Message','Critical','Application','CVE-2023-23397',9.8,0.9240,'Yes','2023-03-14','A calendar reminder with a UNC path sound file makes the client send an NTLM hash to an attacker.','The leaked hash can be relayed to authenticate to other services.','Apply the vendor update, block outbound SMB and consider disabling NTLM.'),
 (25,'Apache Commons Text Variable Interpolation Code Execution (Text4Shell)','Critical','Library','CVE-2022-42889',9.8,0.9140,'Yes','2022-10-13','StringSubstitutor interpolation in Commons Text before 1.10.0 supports script, dns and url lookups by default.','An attacker who controls interpolated input can run code or make network requests.','Upgrade Apache Commons Text to 1.10.0 or later.'),
 (26,'sudo Runas User ID Bypass','High','Operating System','CVE-2019-14287',8.8,0.0820,'No','2019-10-14','A sudoers rule that excludes root can be bypassed by requesting user ID -1.','A user with limited sudo rights can run commands as root.','Upgrade sudo to 1.8.28 or later.'),
 (27,'Linux Kernel Copy-on-Write Race (Dirty COW)','High','Operating System','CVE-2016-5195',7.0,0.9740,'Yes','2016-10-19','A race condition in the kernel memory subsystem allows writes to read-only mappings.','A local user can escalate privileges to root.','Update the kernel to a patched version.'),
 (28,'GNU Bash Environment Variable Code Execution (Shellshock)','Critical','Application','CVE-2014-6271',9.8,0.9750,'Yes','2014-09-24','Bash processes trailing commands after function definitions in environment variables.','A remote attacker can run commands through CGI scripts and other services that set variables.','Upgrade Bash to a patched release and remove unneeded CGI scripts.'),
 (29,'Apache Log4j 1.x JDBCAppender SQL Injection','High','Library','CVE-2022-23305',8.1,0.0410,'No','2022-01-18','The JDBCAppender in Log4j 1.2 builds SQL from user-controlled input without parameterization.','An attacker who controls logged data can alter or read database content.','Migrate off Log4j 1.x to Log4j2 2.17.1 or later.'),
 (30,'Apache Tomcat AJP Request Injection (Ghostcat)','Critical','Application','CVE-2020-1938',9.8,0.9740,'Yes','2020-02-20','The Tomcat AJP connector trusts request attributes, allowing file read and inclusion.','A remote attacker can read web application files and may run code if file upload is possible.','Upgrade Tomcat, disable the AJP connector or require a secret.'),
 (31,'OpenSSL OBJ_obj2txt Excessive Resource Use','Medium','Library','CVE-2023-2650',6.5,0.0020,'No','2023-05-30','Processing a crafted ASN.1 object identifier with OBJ_obj2txt can take a very long time.','An attacker who supplies certificates or other ASN.1 data can cause a denial of service.','Upgrade OpenSSL to a fixed release (3.1.1, 3.0.9, 1.1.1u or later).'),
 (32,'TLS RC4 Cipher Suites Enabled','Medium','Network','CVE-2013-2566',5.9,0.0900,'No','2013-03-15','The RC4 stream cipher has statistical biases that appear in the first bytes of its output.','An attacker who observes many encrypted sessions can recover repeated plaintext such as cookies.','Disable RC4 cipher suites and prefer AES-GCM with TLS 1.2 or later.'),
 (33,'SSH Prefix Truncation Weakness (Terrapin)','Medium','Network','CVE-2023-48795',5.9,0.5700,'No','2023-12-18','SSH extension negotiation can be disrupted by dropping packets during the handshake.','A person-in-the-middle can downgrade connection security features.','Upgrade SSH clients and servers to versions with strict key exchange.'),
 (34,'OpenSSH Username Enumeration','Medium','Application','CVE-2018-15473',5.3,0.9000,'No','2018-08-17','OpenSSH before 7.7 responds differently to valid and invalid usernames during authentication.','A remote attacker can build a list of valid account names.','Upgrade OpenSSH to 7.7 or later.'),
 (35,'jQuery htmlPrefilter Cross-Site Scripting','Medium','Library','CVE-2020-11022',6.1,0.3500,'No','2020-04-29','jQuery before 3.5.0 can run script when passing HTML from untrusted sources to DOM manipulation methods.','An attacker can run script in a victim browser session.','Upgrade jQuery to 3.5.0 or later.'),
 (36,'jQuery Object Prototype Pollution','Medium','Library','CVE-2019-11358',6.1,0.1900,'No','2019-04-20','jQuery before 3.4.0 mishandles jQuery.extend(true, {}, ...) with attacker-controlled objects.','An attacker can modify object prototypes and change application behaviour.','Upgrade jQuery to 3.4.0 or later.'),
 (37,'SSLv3 Padding Oracle (POODLE)','Low','Network','CVE-2014-3566',3.4,0.9400,'No','2014-10-14','SSLv3 CBC padding is not covered by the MAC, which allows a padding oracle attack.','A network attacker can decrypt parts of an encrypted session.','Disable SSLv3 on servers and clients.'),
 (38,'Diffie-Hellman Export Cipher Downgrade (Logjam)','Low','Network','CVE-2015-4000',3.7,0.9000,'No','2015-05-21','TLS servers accepting export-grade Diffie-Hellman parameters can be forced to use weak keys.','A network attacker can downgrade the key exchange and read traffic.','Disable export cipher suites and use 2048-bit or larger DH groups.'),
 (39,'SSH CBC Mode Plaintext Recovery','Low','Network','CVE-2008-5161',2.6,0.7000,'No','2008-11-19','SSH servers that allow CBC ciphers are exposed to a plaintext recovery attack.','A network attacker may recover a small amount of plaintext from an encrypted session.','Remove CBC ciphers from the SSH server configuration.'),
 (40,'TLS Certificate Expires Within 30 Days','Low','Configuration',NULL,NULL,NULL,'No',NULL,'The certificate presented by the service expires within 30 days.','An expired certificate causes outages and trains users to ignore certificate warnings.','Renew and deploy the certificate, and enable automated renewal.'),
 (41,'Self-Signed TLS Certificate','Medium','Configuration',NULL,NULL,NULL,'No',NULL,'The service presents a certificate that is not signed by a trusted certificate authority.','Clients cannot verify the server identity, which makes person-in-the-middle attacks easier.','Replace the certificate with one issued by a trusted certificate authority.'),
 (42,'HTTP TRACE Method Enabled','Low','Configuration',NULL,NULL,NULL,'No',NULL,'The web server answers HTTP TRACE requests.','TRACE can help an attacker read headers such as cookies in some cross-site scripting scenarios.','Disable the TRACE method in the web server configuration.');

INSERT INTO VULNERABILITY_CATALOG
SELECT 42 + g.n,
       b.TITLE || ' [' || GET(ARRAY_CONSTRUCT('Linux','Windows Server','Container image','Network appliance'), FLOOR((g.n - 1) / 42))::STRING || ']',
       b.SEVERITY, b.CATEGORY, b.CVE_ID, b.CVSS_SCORE, b.EPSS_SCORE, b.ACTIVELY_EXPLOITED, b.PUBLISHED_DATE,
       b.SUMMARY, b.THREAT, b.SOLUTION
FROM (SELECT ROW_NUMBER() OVER (ORDER BY SEQ4()) AS n FROM TABLE(GENERATOR(ROWCOUNT => 108))) g
JOIN VULNERABILITY_CATALOG b ON b.CATALOG_ID = ((g.n - 1) % 42) + 1
WHERE b.CATALOG_ID <= 42;

-- -------------------------------------------------- HOST_VULNERABILITIES (2000)
-- ~5% have no application, ~3% have no team, ~1% have no due date.
INSERT INTO HOST_VULNERABILITIES
WITH g AS (
  SELECT ROW_NUMBER() OVER (ORDER BY SEQ4()) AS n FROM TABLE(GENERATOR(ROWCOUNT => 2000))
), b AS (
  SELECT n,
         1 + ABS(HASH(n, 'catalog')) % 150 AS catalog_id,
         1000 + 1 + ABS(HASH(n, 'app')) % 40 AS app_id,
         ABS(HASH(n, 'noise')) % 100 AS noise,
         ABS(HASH(n, 'status')) % 100 AS r_status,
         FLOOR(POWER((ABS(HASH(n, 'ago')) % 1000) / 1000.0, 4) * 365) AS detected_ago,
         (ABS(HASH(n, 'fix')) % 1000) / 1000.0 AS fix_frac
  FROM g
), j AS (
  SELECT b.*, c.SEVERITY AS severity,
         IFF(b.noise < 5, NULL, b.app_id) AS application_id,
         a.APPLICATION_NAME,
         CASE WHEN b.noise < 3 THEN NULL
              WHEN b.noise < 5 THEN 'TEAM-' || LPAD(1 + ABS(HASH(b.n, 'team')) % 12, 3, '0')
              ELSE a.TEAM_ID END AS team_id,
         CASE c.SEVERITY WHEN 'Critical' THEN 15 WHEN 'High' THEN 30 WHEN 'Medium' THEN 90 ELSE 180 END AS sla_days,
         CASE WHEN b.r_status < 70 THEN 'Active' WHEN b.r_status < 95 THEN 'Fixed' ELSE 'Reopened' END AS status
  FROM b
  JOIN VULNERABILITY_CATALOG c ON c.CATALOG_ID = b.catalog_id
  LEFT JOIN APPLICATIONS a ON a.APPLICATION_ID = b.app_id
), d AS (
  SELECT j.*,
         DATEADD(DAY, -detected_ago, CURRENT_DATE()) AS first_detected,
         DATEADD(DAY, -detected_ago + sla_days, CURRENT_DATE()) AS due_date,
         IFF(status = 'Fixed',
             LEAST(CURRENT_DATE(), DATEADD(DAY, 1 + FLOOR(fix_frac * sla_days * 2), DATEADD(DAY, -detected_ago, CURRENT_DATE()))),
             NULL) AS resolved_date
  FROM j
)
SELECT 'HV-' || LPAD(n, 6, '0'),
       catalog_id,
       application_id,
       team_id,
       COALESCE(LOWER(SPLIT_PART(APPLICATION_NAME, ' ', 1)), 'unmapped') || '-'
         || GET(ARRAY_CONSTRUCT('web','app','db','cache','batch'), ABS(HASH(n, 'role')) % 5)::STRING || '-'
         || LPAD(1 + ABS(HASH(n, 'num')) % 24, 2, '0') || '.example.com',
       GET(ARRAY_CONSTRUCT('192.0.2','198.51.100','203.0.113'), ABS(HASH(n, 'net')) % 3)::STRING || '.' || (1 + ABS(HASH(n, 'ip')) % 254),
       GET(ARRAY_CONSTRUCT('Ubuntu 22.04','Red Hat Enterprise Linux 8','Windows Server 2019','Windows Server 2022','Amazon Linux 2','Debian 12'), ABS(HASH(n, 'os')) % 6)::STRING,
       GET(ARRAY_CONSTRUCT(22, 80, 443, 445, 3389, 8080, 8443, 3306), ABS(HASH(n, 'port')) % 8)::NUMBER,
       'TCP',
       severity,
       status,
       CASE WHEN noise = 99 THEN 'No Target'
            WHEN status = 'Fixed' THEN IFF(resolved_date <= due_date, 'On Time', 'Late')
            WHEN due_date < DATEADD(DAY, -30, CURRENT_DATE()) THEN 'Severely Late'
            WHEN due_date < CURRENT_DATE() THEN 'Late'
            WHEN due_date < DATEADD(DAY, 7, CURRENT_DATE()) THEN 'Approaching'
            ELSE 'On Time' END,
       first_detected,
       IFF(status = 'Fixed', GREATEST(first_detected, DATEADD(DAY, -1, resolved_date)),
           DATEADD(DAY, -(ABS(HASH(n, 'seen')) % 3), CURRENT_DATE())),
       IFF(noise = 99, NULL, due_date),
       resolved_date
FROM d;

-- ------------------------------------------------------- CODE_FINDINGS (800)
INSERT INTO CODE_FINDINGS
WITH lib AS (
  SELECT column1 AS idx, column2 AS library_name, column3 AS library_version, column4 AS fixed_version,
         column5 AS cve_id, column6 AS severity, column7 AS title, column8 AS exploit_maturity
  FROM VALUES
    (0,  'log4j-core',        '2.14.1',        '2.17.1',        'CVE-2021-44228', 'Critical', 'Remote code execution through JNDI lookups in Log4j2',     'Mature'),
    (1,  'spring-webmvc',     '5.3.17',        '5.3.18',        'CVE-2022-22965', 'Critical', 'Data binding remote code execution in Spring MVC',         'Mature'),
    (2,  'commons-text',      '1.9',           '1.10.0',        'CVE-2022-42889', 'Critical', 'Arbitrary code execution through string interpolation',    'Proof of Concept'),
    (3,  'struts2-core',      '2.5.10',        '2.5.10.1',      'CVE-2017-5638',  'Critical', 'Remote code execution through the Content-Type header',    'Mature'),
    (4,  'netty-codec-http2', '4.1.93.Final',  '4.1.100.Final', 'CVE-2023-44487', 'High',     'HTTP/2 rapid reset denial of service',                    'Mature'),
    (5,  'libwebp',           '1.3.1',         '1.3.2',         'CVE-2023-4863',  'High',     'Heap buffer overflow when decoding WebP images',          'Mature'),
    (6,  'lodash',            '4.17.15',       '4.17.21',       'CVE-2020-8203',  'High',     'Prototype pollution in zipObjectDeep',                    'Proof of Concept'),
    (7,  'express',           '4.17.1',        '4.17.3',        'CVE-2022-24999', 'High',     'Prototype pollution through query string parsing',        'Proof of Concept'),
    (8,  'Django',            '3.2.0',         '3.2.14',        'CVE-2022-34265', 'Critical', 'SQL injection in Trunc and Extract database functions',   'Proof of Concept'),
    (9,  'requests',          '2.25.0',        '2.31.0',        'CVE-2023-32681', 'Medium',   'Proxy-Authorization header leaked on redirect',           'No Known Exploit'),
    (10, 'PyYAML',            '5.3',           '5.4',           'CVE-2020-14343', 'Critical', 'Arbitrary code execution when loading untrusted YAML',    'Proof of Concept'),
    (11, 'tomcat-embed-core', '9.0.30',        '9.0.31',        'CVE-2020-1938',  'Critical', 'AJP request injection allows file read and inclusion',    'Mature')
), g AS (
  SELECT ROW_NUMBER() OVER (ORDER BY SEQ4()) AS n FROM TABLE(GENERATOR(ROWCOUNT => 800))
), b AS (
  SELECT n,
         ABS(HASH(n, 'lib')) % 12 AS lib_idx,
         1000 + 1 + ABS(HASH(n, 'app')) % 40 AS app_id,
         ABS(HASH(n, 'noise')) % 100 AS noise,
         ABS(HASH(n, 'status')) % 100 AS r_status,
         FLOOR(POWER((ABS(HASH(n, 'ago')) % 1000) / 1000.0, 4) * 365) AS created_ago,
         (ABS(HASH(n, 'fix')) % 1000) / 1000.0 AS fix_frac
  FROM g
), j AS (
  SELECT b.*, l.library_name, l.library_version, l.fixed_version, l.cve_id, l.severity, l.title, l.exploit_maturity,
         a.APPLICATION_NAME, a.TEAM_ID AS app_team,
         CASE l.severity WHEN 'Critical' THEN 15 WHEN 'High' THEN 30 WHEN 'Medium' THEN 90 ELSE 180 END AS sla_days,
         CASE WHEN b.r_status < 65 THEN 'Open' WHEN b.r_status < 90 THEN 'Fixed' ELSE 'Ignored' END AS status
  FROM b
  JOIN lib l ON l.idx = b.lib_idx
  JOIN APPLICATIONS a ON a.APPLICATION_ID = b.app_id
)
SELECT 'CF-' || LPAD(n, 6, '0'),
       app_id,
       IFF(noise < 2, NULL, app_team),
       LOWER(REPLACE(APPLICATION_NAME, ' ', '-')) || '-' || GET(ARRAY_CONSTRUCT('api','web','worker','lib'), ABS(HASH(n, 'repo')) % 4)::STRING,
       title,
       severity,
       status,
       cve_id,
       library_name,
       library_version,
       IFF(noise BETWEEN 2 AND 11, NULL, fixed_version),
       exploit_maturity,
       DATEADD(DAY, -created_ago, CURRENT_DATE()),
       DATEADD(DAY, -created_ago + sla_days, CURRENT_DATE()),
       IFF(status = 'Fixed',
           LEAST(CURRENT_DATE(), DATEADD(DAY, 1 + FLOOR(fix_frac * sla_days * 2), DATEADD(DAY, -created_ago, CURRENT_DATE()))),
           NULL)
FROM j;
