import express from 'express';
import fs from 'fs';
import path from 'path'
import https from 'https';
import { auth, requiresAuth } from 'express-openid-connect'; 
import * as dotenv from 'dotenv';
dotenv.config()

const app = express();
app.set("views", path.join(__dirname, "views"));
app.set('view engine', 'pug');
const { Pool } = require('pg');
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: 5432
});

const port = 4080;

const config = { 
  authRequired : false,
  idpLogout : true, //login not only from the app, but also from identity provider
  secret: process.env.SECRET,
  baseURL: process.env.BASE_URL,
  clientID: process.env.CLIENT_ID,
  issuerBaseURL: 'https://dev-hqi7z0ireb7mg613.us.auth0.com',
  clientSecret: process.env.CLIENT_SECRET,
  authorizationParams: {
    response_type: 'code' ,
    //scope: "openid profile email"   
   },
};

app.use(auth(config));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname + '/stylesheets'));

app.get('/',  function (req, res) {
  let username : string | undefined;
  if (req.oidc.isAuthenticated()) {
    username = req.oidc.user?.name ?? req.oidc.user?.sub;
    console.log(req.oidc.user)
  }
  res.render('index', {username});
});

app.get("/sign-up", (req, res) => {
  res.oidc.login({
    returnTo: '/',
    authorizationParams: {      
      screen_hint: "signup",
    },
  });
});

app.get("/competitions", function (req, res) {
  let username : string | undefined;
  let compets : any[] = [];
  if (req.oidc.isAuthenticated()) {
    username = req.oidc.user?.name ?? req.oidc.user?.sub;
  }

  pool.query("SELECT * FROM competitions ORDER BY competition_id DESC",
    (err: any, results: any) => {
      if (err) {
        throw err;
      }
      compets = results.rows;
      console.log(compets)
      res.render('competitions', {compets, username});
    }
  );
});

app.get("/new-competition", requiresAuth(), function (req, res) {
  let username : string | undefined;
  if (req.oidc.isAuthenticated()) {
    username = req.oidc.user?.name ?? req.oidc.user?.sub;
  }
  res.render('createNew', {username});
});

app.post("/new-competition", requiresAuth(), function (req, res) {
  let competitionId : number;
  let username : string | undefined;
  let sub : string | undefined;
  if (req.oidc.isAuthenticated()) {
    username = req.oidc.user?.name ?? req.oidc.user?.sub;
    sub = req.oidc.user?.sub;
  }
  const name = req.body.name;
  const win = req.body.win;
  const draw = req.body.draw;
  const loss = req.body.loss;
  const participants = req.body.participants.split(",");
  // check validity of input
  if (!name || !win || !draw || !loss || !participants) {
    res.redirect("/new-competition");
  }

  if (isNaN(win) || isNaN(draw) || isNaN(loss)) {
    res.redirect("/new-competition");
  }

  if (win < 0 || draw < 0 || loss < 0) {
    res.redirect("/new-competition");
  }


  const system = win + "/" + draw + "/" + loss;
  
  if (participants.length < 4 || participants.length > 8) {
    alert("Please enter between 4 and 8 participants");
    return;
  }
  // generate round robin rounds
  const participantsCopy : any[] = Array.from(participants);
  if (participants.length % 2 == 1) {
    participantsCopy.push(null);
  }
  const rounds : any[] = [];
  const roundNum = participantsCopy.length - 1;
  const mPerRound = participantsCopy.length / 2;
  for (let i = 0; i < roundNum; i++) {
    const round : any[] = [];
    for (let j = 0; j < mPerRound; j++) {
      const match : any[] = [];
      match.push(participantsCopy[j], participantsCopy[participantsCopy.length - 1 - j]);
      round.push(match);
    }
    rounds.push(round);
    participantsCopy.splice(1, 0, participantsCopy.pop());
  }
  // database has 3 tables: competitions, rounds and matches
  // competitions has the name and system of the competition
  // rounds has the competition id and the round number
  // matches has the round id, the participants and the scores
  pool.query(
    "INSERT INTO competitions (name, system, organizer, organizerName) VALUES ($1, $2, $3, $4) RETURNING competition_id",
    [name, system, sub, username],
    (err: any, results: any) => {
      if (err) {
        throw err;
      }
      competitionId = results.rows[0].competition_id;
      for (let i = 0; i < rounds.length; i++) {
        const round = rounds[i];
        pool.query(
          "INSERT INTO rounds (competition_id, round_number) VALUES ($1, $2) RETURNING round_id",
          [competitionId, i + 1],
          (err: any, results: any) => {
            if (err) {
              throw err;
            }
            const roundId = results.rows[0].round_id;
            for (let j = 0; j < round.length; j++) {
              const match = round[j];
              pool.query(
                "INSERT INTO matches (round_id, player1, player2) VALUES ($1, $2, $3)",
                [roundId, match[0], match[1]],
                (err: any, results: any) => {
                  if (err) {
                    throw err;
                  }
                }
              );
            }
          }
        );
      }
      res.redirect("/competitions");
    }
  );
});
 
app.get("/competition/:id", function (req, res) {
// get competition with id from database
// get rounds for competition, and for each round get matches, save to map
// render competition with rounds and matches
  const id = req.params.id;
  let username : string | undefined;
  let matches : any[] = [];
  let sub : string | undefined;
  if (req.oidc.isAuthenticated()) {
    username = req.oidc.user?.name ?? req.oidc.user?.sub;
    sub = req.oidc.user?.sub;
  }
  pool.query(
    "SELECT * FROM competitions NATURAL JOIN rounds NATURAL JOIN matches WHERE competition_id = $1 ORDER BY round_number ASC",
    [id],
    (err: any, results: any) => {
      if (err) {
        throw err;
      }
      matches = results.rows;
      // make a sorted leaderboard with participants and points
      // sort by points, then by name
      const participants : any[] = [];
      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        if (!participants.includes(match.player1)) {
          participants.push(match.player1);
        }
        if (!participants.includes(match.player2)) {
          participants.push(match.player2);
        }
      }
      const leaderboard : any[] = [];
      for (let i = 0; i < participants.length; i++) {
        const participant = participants[i];
        let points = 0;
        for (let j = 0; j < matches.length; j++) {
          const match = matches[j];
          if (match.player1 == participant) {
            points += match.score1;
          }
          else if (match.player2 == participant) {
            points += match.score2;
          }
        }
        leaderboard.push([participant, points]);
      }
      leaderboard.sort(function(a, b) {
        if (a[1] == b[1]) {
          return a[0] > b[0] ? 1 : -1;
        }
        return b[1] - a[1];
      });
      console.log(leaderboard);
      console.log(matches);
      res.render('competition', {matches, username, leaderboard, sub});
    }
  );
}
);

app.post("/competition/:id", requiresAuth(), function (req, res) {
  // delete competition with id from database
  const id = req.params.id;
  pool.query(
    "DELETE FROM competitions WHERE competition_id = $1",
    [id],
    (err: any, results: any) => {
      if (err) {
        throw err;
      }
    }
  );
  res.redirect("/competitions");
}
);

app.post("/competition/:id/:match", requiresAuth(), function (req, res) {
  const id = req.params.id;
  const matchId = req.params.match;
  const score = req.body.score;

  // if url has delete parameter, delete match
  if (req.body.delete) {
    pool.query(
      "SELECT * FROM competitions WHERE competition_id = $1",
      [id],
      (err: any, results: any) => {
        if (err) {
          throw err;
        }
        const ptsSystem = results.rows[0].system;
        pool.query(
          "SELECT * FROM matches WHERE match_id = $1",
          [matchId],
          (err: any, results: any) => {
            if (err) {
              throw err;
            }
            const match = results.rows[0];
            let score1, score2;
            if (match.winner == 1) {
              score1 = ptsSystem.split("/")[0];
              score2 = ptsSystem.split("/")[2];
            }
            else if (match.winner == 2) {
              score1 = ptsSystem.split("/")[2];
              score2 = ptsSystem.split("/")[0];
            }
            else {
              score1 = ptsSystem.split("/")[1];
              score2 = ptsSystem.split("/")[1];
            }

            if (match.score1 - score1 == 0) {
              score1 = null;
            }
            if (match.score2 - score2 == 0) {
              score2 = null;
            }
            pool.query(
              "UPDATE matches SET score1 = COALESCE(score1, 0) - $1, score2 = COALESCE(score2, 0) - $2, winner = NULL WHERE match_id = $3",
              [score1, score2, matchId],
              (err: any, results: any) => {
                if (err) {
                  throw err;
                }
                res.redirect("/competition/" + id);
              }
            );
          }
        );
      }
    );
    return;
  }

  let winner : number;
  if (score == "win") {
    winner = 1;
  }
  else if (score == "loss") {
    winner = 2;
  }
  else {
    winner = 0;
  }
  
  pool.query(
    "SELECT * FROM competitions WHERE competition_id = $1",
    [id],
    (err: any, results: any) => {
      if (err) {
        throw err;
      }
      const ptsSystem = results.rows[0].system;
      let win, draw, loss : number;
      win = ptsSystem.split("/")[0];
      draw = ptsSystem.split("/")[1];
      loss = ptsSystem.split("/")[2];
      let score1, score2 = 0;
      if (winner == 1) {
        score1 = win;
        score2 = loss;

      }
      else if (winner == 2) {
        score1 = loss;
        score2 = win;
      }
      else {
        score1 = draw;
        score2 = draw;
      }
      pool.query(
        // update match with id, add score to player1 and player2, but if score is null replace with 0
        "UPDATE matches SET score1 = COALESCE(score1, 0) + $1, score2 = COALESCE(score2, 0) + $2, winner = $4 WHERE match_id = $3",
        [score1, score2, matchId, winner],
        (err: any, results: any) => {
          if (err) {
            throw err;
          }
          res.redirect("/competition/" + id);
        }
      );
    }
  );
}
);

// create server without key and cert
app.listen(port, () => {
  console.log(`Lab1 app listening at port ${port}`)
 })
