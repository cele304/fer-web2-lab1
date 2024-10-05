// index.js

require('dotenv').config(); //ovime se ukljucuje env datoteka, obavezno to makni iz gita, jer su tamo api kljucevi i ostale bitnije stvari


const express = require('express');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const bodyParser = require('body-parser');
const { auth, requiresAuth } = require('express-openid-connect');
const fetch = require('node-fetch');

const app = express();  //za pokretanje express aplikacije

// Middleware za parsiranje JSON i URL-encoded tijela
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Za URL-encoded podatke, ovo mi je falilo za prikaz qr koda

app.use(express.static('public'));  // Služi statičke datoteke iz mape "public", da moze se ukljuciti css




// PostgreSQL baza podataka
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});



// Body parser za primanje JSON zahtjeva
app.use(bodyParser.json());



// Auth0 konfiguracija za OpenID Connect i OAuth2
const config = {
  authRequired: false,
  auth0Logout: true,
  secret: process.env.AUTH0_CLIENT_SECRET,
  baseURL: process.env.BASE_URL,
  clientID: process.env.AUTH0_CLIENT_ID,
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}`,
};

app.use(auth(config));




// 1. Početna stranica koja prikazuje broj generiranih ulaznica
//za ispis trenutnog korisnika u res.send dodat i  <p>Trenutni korisnik: ${userName}</p>, a prije res.senda const userName = req.oidc.user ? req.oidc.user.name : 'Nepoznato';
//dodao sam usera user@user.com s lozinkom NTFmc47kpe
app.get('/', async (req, res) => {
    const userName = req.oidc.user ? req.oidc.user.name : 'Neprijavljen';
    let content = `
      <html>
        <head>
          <link rel="stylesheet" type="text/css" href="/css/styles.css">
          <title>Ulaznice</title>
        </head>
        <body>
          <div class="container">
            <p>Broj ukupno izgeneriranih ulaznica: ${await getTicketCount()}</p>
            ${req.oidc.isAuthenticated() ? `
              <h1>Dobrodošli, ${userName}!</h1>
              <h2>Opcije:</h2>
              <form action="/generate-ticket" method="post">
                <input type="text" name="vatin" placeholder="OIB" required />
                <input type="text" name="firstName" placeholder="Ime" required />
                <input type="text" name="lastName" placeholder="Prezime" required />
                <button type="submit">Generiraj ulaznicu</button>
              </form>

              <h2>Pogledajte ulaznicu</h2>

              <input type="text" id="ticketIdInput" placeholder="ID ulaznice" required />
              <button onclick="viewTicket()">Prikaži ulaznicu</button>
              <p><a href="/logout">Odjavite se</a></p>
            ` : `
              <p><a href="/login">Prijavite se</a></p>
            `}
          </div>
          <script>
            function viewTicket() {
              const ticketId = document.getElementById('ticketIdInput').value.trim();
              if (ticketId) {
                window.location.href = \`/ticket/\${ticketId}\`;
              }
            }
          </script>
        </body>
      </html>
    `;
    res.send(content);
});

  
  // Funkcija za dohvaćanje broja ulaznica
  async function getTicketCount() {
    const result = await pool.query('SELECT COUNT(*) FROM tickets');
    return result.rows[0].count;
  }
  // Funkcija viewTicket gore sluzi za pravilno preusmjeravanje kada zatrazujes ulaznicu
 
  
  
  




// Rute za prijavu i odjavu
app.get('/login', (req, res) => {
    res.oidc.login({
      authorizationParams: {
        response_type: 'code', // promijenjeno na 'code'
        scope: 'openid profile email',
        redirect_uri: 'http://localhost:3000/callback',
      },
    });
  });
  
  
app.get('/logout', (req, res) => {
    res.oidc.logout(); // ovo će odjaviti korisnika
  });
  




// 1. Pristupna točka za generiranje ulaznica
app.post('/generate-ticket', async (req, res) => {
    const { vatin, firstName, lastName } = req.body;

    // Provjera da li su svi podaci prisutni
    if (!vatin || !firstName || !lastName) {
        return res.status(400).json({ error: 'Nedostaju podaci.' });
    }

    // Ostatak koda za generiranje ulaznice
    try {
        // Provjera koliko ulaznica je već generirano za ovaj OIB
        const result = await pool.query('SELECT COUNT(*) FROM tickets WHERE vatin = $1', [vatin]);
        const ticketCount = parseInt(result.rows[0].count);

        if (ticketCount >= 3) {
            return res.status(400).json({ error: 'Za navedeni OIB već su generirane 3 ulaznice.' });
        }

        // Kreiraj novu ulaznicu s UUID-om
        const ticketId = uuidv4();
        const createdAt = new Date();
        await pool.query(
            'INSERT INTO tickets (id, vatin, firstName, lastName, createdAt) VALUES ($1, $2, $3, $4, $5)',
            [ticketId, vatin, firstName, lastName, createdAt]
        );

        // Preusmjeri korisnika na URL s UUID-om
        res.redirect(`${process.env.BASE_URL}/generate-ticket/${ticketId}`);

    } catch (err) {
        console.error(err); // Ispis greške
        res.status(500).json({ error: 'Greška pri generiranju ulaznice.' });
    }
});

// 2. Pristupna točka za prikaz QR koda
app.get('/generate-ticket/:ticketId', async (req, res) => {
    const { ticketId } = req.params;

    try {
        // Generiraj QR kod s URL-om koji uključuje UUID ulaznice
        const qrUrl = `${process.env.BASE_URL}/generate-ticket/${ticketId}`;
        const qrCode = await QRCode.toDataURL(qrUrl);

        // Vraćanje slike s QR kodom
        res.send(`
            <html>
                <head>
                    <link rel="stylesheet" type="text/css" href="/css/styles.css">
                    <title>Generirana ulaznica</title>
                </head>
                <body>
                    <div class="container">
                        <h1>Vaša ulaznica je uspješno generirana!</h1>
                        <p>Molimo vas da preuzmete i prikažete QR kod pri ulasku.</p>
                        <img src="${qrCode}" alt="QR kod za ulaznicu" class="qr-code" />
                        <a href="/">Natrag na početnu stranicu</a>
                    </div>
                </body>
            </html>
        `);

    } catch (err) {
        console.error(err); // Ispis greške
        res.status(500).json({ error: 'Greška pri generiranju QR koda.' });
    }
});

  









// 3. Stranica koja prikazuje detalje ulaznice (za prijavljene korisnike)
app.get('/ticket/:id', requiresAuth(), async (req, res) => {
    const ticketId = req.params.id;
  
    try {
      const result = await pool.query('SELECT * FROM tickets WHERE id = $1', [ticketId]);
  
      if (result.rows.length === 0) {
        return res.status(404).send('Ulaznica nije pronađena.');
      }
  
      const ticket = result.rows[0];
      const userName = req.oidc.user ? req.oidc.user.name : 'Nepoznato'; //ispis trenutno prijavljenog korisnika koristeci OpenId Connect protokol, toj stranici pristup imaju samo prijavljeni korisnici
  
      res.send(`
        <html>
          <head>
            <link rel="stylesheet" type="text/css" href="/css/styles.css">
            <title>Detalji o ulaznici</title>
          </head>
          <body>
            <div class="container">
              <h1>Detalji o ulaznici</h1>
              <p><strong>Ime:</strong> ${ticket.firstname}</p>
              <p><strong>Prezime:</strong> ${ticket.lastname}</p>
              <p><strong>OIB:</strong> ${ticket.vatin}</p>
              <p><strong>Kreirano:</strong> ${ticket.createdat}</p>
              <p><strong>Trenutni korisnik:</strong> ${userName}</p>
              <a href="/">Natrag na početnu</a>
            </div>
          </body>
        </html>
      `);
      
    } catch (err) {
      res.status(500).send('Greška pri dohvaćanju ulaznice.');
    }
  });









// Pokreni server
//const PORT = process.env.PORT || 3000; //vec ga imas gore
app.listen(process.env.PORT, () => {
  console.log(`Server pokrenut na portu ${process.env.PORT}`);
});
