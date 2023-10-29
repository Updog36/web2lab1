CREATE TABLE competitions (
    competition_id SERIAL UNIQUE PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    system VARCHAR(32) NOT NULL,
    organizer VARCHAR(255) NOT NULL,
    organizerName VARCHAR(255) NOT NULL
);

CREATE TABLE rounds (
    round_id SERIAL UNIQUE PRIMARY KEY,
    competition_id INTEGER NOT NULL,
    round_number INTEGER NOT NULL,
    FOREIGN KEY (competition_id) REFERENCES competitions(competition_id) ON DELETE CASCADE
);

CREATE TABLE matches (
    match_id SERIAL UNIQUE PRIMARY KEY,
    round_id INTEGER NOT NULL,
    player1 VARCHAR(32) NOT NULL,
    player2 VARCHAR(32) NOT NULL,
    score1 INTEGER DEFAULT NULL,
    score2 INTEGER DEFAULT NULL,
    winner INTEGER DEFAULT NULL,
    FOREIGN KEY (round_id) REFERENCES rounds(round_id) ON DELETE CASCADE
);