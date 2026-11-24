import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('demo-vault');
const folder = resolve(root, '_openmarks/bookmarks');
const data = {
  'Technology & Development': [
    ['Python Documentation','https://docs.python.org/3/','Official Python language and standard library documentation.','Python,Development,Documentation'],
    ['MDN Web Docs','https://developer.mozilla.org/','Reference for web standards, HTML, CSS, and JavaScript.','Web,Development,Reference'],
    ['Git Documentation','https://git-scm.com/doc','Official Git reference and learning resources.','Git,Open source,Development'],
    ['GitHub Documentation','https://docs.github.com/','Guides for repositories, collaboration, and GitHub features.','GitHub,Development,Documentation'],
    ['TypeScript Documentation','https://www.typescriptlang.org/docs/','Official TypeScript handbook and language reference.','TypeScript,Development,Documentation'],
    ['The Rust Programming Language','https://doc.rust-lang.org/book/','The official introductory Rust programming book.','Rust,Programming,Open source'],
    ['Linux Kernel Documentation','https://docs.kernel.org/','Documentation for the Linux kernel and its subsystems.','Linux,Kernel,Documentation'],
    ['Debian','https://www.debian.org/','Project information, downloads, and documentation for Debian.','Linux,Debian,Open source'],
    ['Docker Documentation','https://docs.docker.com/','Guides and references for Docker tools and containers.','Docker,Containers,Development'],
    ['Kubernetes Documentation','https://kubernetes.io/docs/','Official guides for deploying and operating Kubernetes.','Kubernetes,Containers,Documentation'],
    ['Node.js Documentation','https://nodejs.org/docs/latest/api/','API reference for the Node.js JavaScript runtime.','Node.js,JavaScript,Development'],
    ['Go Documentation','https://go.dev/doc/','Official documentation and tutorials for the Go language.','Go,Programming,Documentation'],
    ['SQLite Documentation','https://www.sqlite.org/docs.html','Documentation for the embedded SQLite database engine.','SQLite,Database,Reference'],
    ['PostgreSQL Documentation','https://www.postgresql.org/docs/','Official manuals for the PostgreSQL database system.','PostgreSQL,Database,Reference'],
    ['Obsidian Help','https://help.obsidian.md/','Official guides for using Obsidian and its features.','Obsidian,Notes,Documentation'],
  ],
  'Cybersecurity & Privacy': [
    ['CISA Secure by Design','https://www.cisa.gov/securebydesign','Guidance and resources for secure technology development.','CISA,Security,Guidance'],
    ['NIST Cybersecurity Framework','https://www.nist.gov/cyberframework','NIST resources for organizing cybersecurity risk management.','NIST,Security,Framework'],
    ['OWASP Top 10','https://owasp.org/www-project-top-ten/','Awareness document describing common web application risks.','OWASP,AppSec,Web'],
    ['MITRE ATT&CK','https://attack.mitre.org/','Knowledge base of adversary tactics and techniques.','MITRE,Threat intelligence,Reference'],
    ['CIS Critical Security Controls','https://www.cisecurity.org/controls','Prioritized safeguards for defending systems and networks.','CIS,Security,Controls'],
    ['Wireshark Documentation','https://www.wireshark.org/docs/','User guides and references for the network protocol analyzer.','Wireshark,Networking,Open source'],
    ['WireGuard','https://www.wireguard.com/','Project documentation for the WireGuard VPN protocol.','VPN,Networking,Open source'],
    ['Tor Project','https://www.torproject.org/','Project information and documentation for Tor software.','Privacy,Open source,Networking'],
    ['Mozilla Privacy','https://www.mozilla.org/en-US/privacy/','Mozilla privacy principles, policies, and related resources.','Privacy,Web,Reference'],
    ['EFF Surveillance Self-Defense','https://ssd.eff.org/','Practical guides for protecting devices and communications.','Privacy,Security,Guides'],
    ['Check Point Documentation','https://sc1.checkpoint.com/documents/','Product manuals and technical references from Check Point.','Firewalls,Documentation,Security'],
    ['Palo Alto Networks Documentation','https://docs.paloaltonetworks.com/','Product documentation and technical references.','Firewalls,Documentation,Security'],
    ['Zscaler Help Portal','https://help.zscaler.com/','Product help and technical documentation for Zscaler services.','SASE,Documentation,Security'],
    ['RFC Editor','https://www.rfc-editor.org/','The RFC publication index for Internet standards and research.','Internet,Standards,Reference'],
    ['Cloudflare Learning Center','https://www.cloudflare.com/learning/','Plain-language articles on Internet and security concepts.','Internet,Security,Learning'],
  ],
  'Science & Research': [
    ['NASA','https://www.nasa.gov/','Mission, science, and educational resources from NASA.','Space,Science,Research'],
    ['NOAA','https://www.noaa.gov/','Weather, climate, ocean, and environmental information.','Climate,Weather,Science'],
    ['National Science Foundation','https://www.nsf.gov/','Information about U.S. science research and funding.','Research,Science,Education'],
    ['PubMed','https://pubmed.ncbi.nlm.nih.gov/','Search service for biomedical and life sciences literature.','Medicine,Research,Reference'],
    ['arXiv','https://arxiv.org/','Open repository of scholarly preprints across many fields.','Research,Open access,Science'],
    ['CERN','https://home.cern/','Research organization exploring fundamental physics.','Physics,Research,Science'],
    ['Smithsonian Science Education Center','https://ssec.si.edu/','Science learning resources and programs from the Smithsonian.','Science,Education,Learning'],
    ['USGS','https://www.usgs.gov/','U.S. geological, water, ecosystem, and mapping science.','Earth science,Data,Research'],
    ['National Academies','https://www.nationalacademies.org/','Independent reports and resources on science and policy topics.','Research,Reports,Reference'],
    ['ScienceDaily','https://www.sciencedaily.com/','News summaries about recent research across scientific fields.','Science,News,Research'],
    ['Our World in Data','https://ourworldindata.org/','Open research and visualizations about global conditions.','Data,Research,Open access'],
    ['CDC Data','https://data.cdc.gov/','Public datasets from the U.S. Centers for Disease Control.','Public health,Data,Research'],
    ['European Space Agency','https://www.esa.int/','European space missions, science, and educational material.','Space,Science,Research'],
    ['National Institutes of Health','https://www.nih.gov/','Health research news and public science resources.','Health,Research,Science'],
    ['Biodiversity Heritage Library','https://www.biodiversitylibrary.org/','Open access literature on biodiversity and natural history.','Biodiversity,Books,Research'],
  ],
  'Education & Learning': [
    ['MIT OpenCourseWare','https://ocw.mit.edu/','Free course materials from MIT classes.','Courses,Open access,Learning'],
    ['Khan Academy','https://www.khanacademy.org/','Free lessons and practice across school and college subjects.','Learning,Math,Education'],
    ['OpenStax','https://openstax.org/','Free, peer-reviewed textbooks for common courses.','Textbooks,Open access,Education'],
    ['Harvard Online','https://pll.harvard.edu/','Online courses and learning programs from Harvard.','Courses,Learning,Education'],
    ['Stanford Online','https://online.stanford.edu/','Online courses and learning opportunities from Stanford.','Courses,Learning,Education'],
    ['edX','https://www.edx.org/','Online courses and programs from universities and institutions.','Courses,Learning,Education'],
    ['Coursera','https://www.coursera.org/','Online learning catalog with courses from institutions and companies.','Courses,Learning,Education'],
    ['Open Yale Courses','https://oyc.yale.edu/','Free introductory courses and lecture materials from Yale.','Courses,Open access,Learning'],
    ['Carnegie Mellon Open Learning Initiative','https://oli.cmu.edu/','Open and research-based online course materials.','Courses,Research,Education'],
    ['Saylor Academy','https://www.saylor.org/','Free online courses and self-paced learning resources.','Courses,Open access,Learning'],
    ['OpenLearn','https://www.open.edu/openlearn/','Free courses and learning resources from The Open University.','Courses,Open access,Education'],
    ['FutureLearn','https://www.futurelearn.com/','Online courses from universities and cultural institutions.','Courses,Learning,Education'],
    ['freeCodeCamp','https://www.freecodecamp.org/','Free programming curriculum and community projects.','Programming,Open source,Learning'],
    ['Library of Congress Research Guides','https://guides.loc.gov/','Research guides to collections and subjects at the Library of Congress.','Research,Library,Learning'],
    ['Crash Course','https://thecrashcourse.com/','Educational video series covering a range of academic subjects.','Video,Learning,Education'],
  ],
  'Books & Reference': [
    ['Project Gutenberg','https://www.gutenberg.org/','A large collection of free public domain ebooks.','Books,Open access,Reading'],
    ['Internet Archive','https://archive.org/','Nonprofit digital library of books, media, and archived websites.','Archive,Books,Research'],
    ['Open Library','https://openlibrary.org/','An open catalog with information about books and authors.','Books,Catalog,Reference'],
    ['Library of Congress','https://www.loc.gov/','Collections, research materials, and services from the U.S. national library.','Library,Research,Reference'],
    ['Stanford Encyclopedia of Philosophy','https://plato.stanford.edu/','Peer-reviewed reference articles in philosophy.','Philosophy,Reference,Research'],
    ['Encyclopaedia Britannica','https://www.britannica.com/','General reference articles and educational resources.','Reference,Learning,Encyclopedia'],
    ['Wikisource','https://wikisource.org/','Free digital library of source texts maintained by volunteers.','Books,Open access,Reference'],
    ['WorldCat','https://www.worldcat.org/','Search tool for books and other materials held by libraries.','Library,Catalog,Books'],
    ['Standard Ebooks','https://standardebooks.org/','Carefully formatted public domain ebooks.','Books,Open access,Reading'],
    ['Wiktionary','https://www.wiktionary.org/','Collaborative multilingual dictionary and thesaurus.','Dictionary,Language,Reference'],
  ],
  'News & Media': [
    ['Reuters','https://www.reuters.com/','International reporting and news coverage.','News,World,Reporting'],
    ['Associated Press','https://apnews.com/','Independent news reporting from the Associated Press.','News,World,Reporting'],
    ['BBC News','https://www.bbc.com/news','News coverage from the BBC.','News,World,Reporting'],
    ['NPR','https://www.npr.org/','Public radio news, reporting, and cultural programming.','News,Audio,Public media'],
    ['PBS NewsHour','https://www.pbs.org/newshour/','Public television news and current affairs reporting.','News,Public media,Video'],
    ['Deutsche Welle','https://www.dw.com/','International news and analysis from Germany’s public broadcaster.','News,World,Reporting'],
    ['France 24','https://www.france24.com/en/','International news coverage and live reporting.','News,World,Video'],
    ['The Conversation','https://theconversation.com/','Articles by academics and researchers for general readers.','Research,News,Education'],
    ['ProPublica','https://www.propublica.org/','Nonprofit investigative journalism and public records projects.','News,Investigations,Nonprofit'],
    ['Nieman Lab','https://www.niemanlab.org/','Reporting and analysis on the future of journalism.','Media,News,Research'],
  ],
  'Productivity & Tools': [
    ['Obsidian','https://obsidian.md/','Knowledge management application based on local Markdown files.','Notes,Productivity,Markdown'],
    ['Zotero','https://www.zotero.org/','Free tool for collecting, organizing, citing, and sharing research.','Research,Productivity,Open source'],
    ['LibreOffice','https://www.libreoffice.org/','Free office suite for documents, spreadsheets, and presentations.','Office,Productivity,Open source'],
    ['Joplin','https://joplinapp.org/','Open-source note-taking and task management application.','Notes,Productivity,Open source'],
    ['Mozilla Thunderbird','https://www.thunderbird.net/','Free email, calendar, and contacts application.','Email,Productivity,Open source'],
    ['Syncthing','https://syncthing.net/','Open-source continuous file synchronization between devices.','Files,Privacy,Open source'],
    ['Nextcloud','https://nextcloud.com/','Self-hosted collaboration and file sharing platform.','Files,Collaboration,Open source'],
    ['GIMP','https://www.gimp.org/','Free, open-source image editor.','Images,Design,Open source'],
    ['Inkscape','https://inkscape.org/','Free, open-source vector graphics editor.','Design,Graphics,Open source'],
    ['Calibre','https://calibre-ebook.com/','Open-source ebook library management and conversion software.','Books,Productivity,Open source'],
  ],
  'Culture & Museums': [
    ['Smithsonian Institution','https://www.si.edu/','Museum, research, and educational resources from the Smithsonian.','Museum,Culture,Education'],
    ['The Metropolitan Museum of Art','https://www.metmuseum.org/','Collection, exhibitions, and learning resources from The Met.','Museum,Art,Culture'],
    ['National Gallery of Art','https://www.nga.gov/','Art collections, exhibitions, and educational resources.','Museum,Art,Culture'],
    ['British Museum','https://www.britishmuseum.org/','Collections and research resources from the British Museum.','Museum,History,Culture'],
    ['Rijksmuseum','https://www.rijksmuseum.nl/en','Museum collections and art history resources from Amsterdam.','Museum,Art,Culture'],
    ['Europeana','https://www.europeana.eu/','Digital access to cultural heritage collections across Europe.','Culture,Archive,Open access'],
    ['Google Arts & Culture','https://artsandculture.google.com/','Online exhibitions and digitized cultural collections.','Culture,Art,Collections'],
    ['Museum of Modern Art','https://www.moma.org/','Collection, exhibitions, and learning resources from MoMA.','Museum,Art,Culture'],
    ['Getty Museum','https://www.getty.edu/','Art, research, and educational resources from the Getty.','Museum,Art,Research'],
    ['Smithsonian Open Access','https://www.si.edu/openaccess','Public access to Smithsonian digital collection assets.','Open access,Collections,Culture'],
  ],
};

const all = Object.entries(data).flatMap(([category, rows]) => rows.map((row) => ({ category, row })));
if (all.length !== 100) throw new Error(`Expected 100 demo entries, received ${all.length}`);
await mkdir(folder, { recursive: true });
for (const name of await readdir(folder)) if (name.endsWith('.md')) await rm(resolve(folder, name));
for (const [index, { category, row }] of all.entries()) {
  const [title, url, description, tagsRaw] = row;
  const domain = new URL(url).hostname;
  const id = `sample-${String(index + 1).padStart(3, '0')}`;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const collection = `${category}/${category === 'Technology & Development' ? 'Development' : category === 'Cybersecurity & Privacy' ? 'Security' : category === 'Science & Research' ? 'Research' : category === 'Education & Learning' ? 'Courses' : category === 'Books & Reference' ? 'Reference' : category === 'News & Media' ? 'News' : category === 'Productivity & Tools' ? 'Tools' : 'Museums'}`;
  const tags = tagsRaw.split(',').map((tag) => `  - ${JSON.stringify(tag.trim().replace(/\s+/g, '-'))}`).join('\n');
  const favorite = (index % 10 === 1 || index % 10 === 6) ? 'true' : 'false';
  const status = index % 4 === 0 ? 'read' : 'unread';
  const daysAgo = index < 10 ? index : 10 + (index % 71);
  const created = new Date(Date.UTC(2026, 10, 23 - daysAgo)).toISOString().slice(0, 10);
  const body = `Sample bookmark from the OpenMarks demonstration library. Category: ${category}.`;
  const note = `---\ntype: bookmark\nid: ${id}\ntitle: ${JSON.stringify(title)}\nurl: ${url}\ndomain: ${domain}\ndescription: ${JSON.stringify(description)}\ncollection: ${JSON.stringify(collection)}\ntags:\n${tags}\nfavorite: ${favorite}\nstatus: ${status}\ncreated: ${created}\nlast_opened:\nsample: true\n---\n${body}\n`;
  await writeFile(resolve(folder, `${slug}-${id}.md`), note, 'utf8');
}
console.log(`Wrote ${all.length} sample bookmarks in ${Object.entries(data).map(([k,v])=>`${k}: ${v.length}`).join('; ')}`);
