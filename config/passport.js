const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const neo4j = require('neo4j-driver');
const _ = require('lodash');

const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', '123456'));
const session = driver.session();


module.exports = function (passport) {
    passport.use(new LocalStrategy({
        usernameField: 'email'
    }, (email, password, done) => { 
        
        // Match user
        session.run('MATCH (user:User {email:$emailParam}) RETURN user', {emailParam: email}).then(user => {
            if (_.isEmpty(user.records)) {
                return done(null, false, {message: 'Ne postoji korisnik sa datim emailom'});
           } 

            // Match password
            bcrypt.compare(password, user.records[0]._fields[0].properties.sifra, (err, isMatch) => {
                if (err) 
                    console.log(err);
            
                if (isMatch) {
                    return done(null, user.records[0]._fields[0].properties);
                } else {
                    return done(null, false, {message: 'Pogrešna lozinka'});
                }

            });
        });
    }));

    passport.serializeUser(function (user, done) {
        done(null, user);
    });

    passport.deserializeUser(function (user, done) {
        done(null, user);
    });
};
