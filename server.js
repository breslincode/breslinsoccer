/*  Copyright 2012-2016 Sven "underscorediscovery" Bergström
    
    written by : http://underscorediscovery.ca
    written for : http://buildnewgames.com/real-time-multiplayer/
    
    MIT Licensed.
*/
var ServerGame = require('./server.game');
var ServerCore = require('./server.core');

var Server = new Class(
{
initialize: function()
{
	this.games = new Array();
	this.serverClients = new Array();
	this.game_count = 0;

        this.verbose     = true;

        //Since we are sharing code with the browser, we
        //are going to include some values to handle that.

        //A simple wrapper for logging so we can toggle it,
        //and augment it for clarity.
    	this.fake_latency = 0;
    	this.local_time = 0;
    	this._dt = new Date().getTime();
    	this._dte = new Date().getTime();
        //a local queue of messages we delay if faking latency
    	this.messages = [];
},

log: function() 
{
	if(this.verbose) 
	{
		console.log.apply(this,arguments);
	}
},

onMessage: function(client,message) 
{
	if(this.fake_latency && message.split('.')[0].substr(0,1) == 'i') 
	{
        	//store all input message
            	this.messages.push({client:client, message:message});
            	setTimeout(function()
		{
                	if(this.messages.length) 
			{
                    		this._onMessage( this.messages[0].client, this.messages[0].message );
                    		this.messages.splice(0,1);
                	}
            	}.bind(this), this.fake_latency);

        } 
	else 
	{
        	this._onMessage(client, message);
        }
},
    
_onMessage: function(client,message) 
{
	//Cut the message up into sub components
        var message_parts = message.split('.');

        //The first is always the type of message
        var message_type = message_parts[0];

        var other_client =
            (client.game.player_host.userid == client.userid) ?
             client.game.player_client : client.game.player_host;

        if (message_type == 'i') 
	{
        	//Input handler will forward this
            	this.onInput(client, message_parts);
        } 
	else if (message_type == 'p') 
	{
        	client.send('s.p.' + message_parts[1]);
        } 
	else if (message_type == 'c') 
	{    
		//Client changed their color!
            	if(other_client)
                other_client.send('s.c.' + message_parts[1]);
        } 
	else if (message_type == 'l') 
	{    //A client is asking for lag simulation
            	this.fake_latency = parseFloat(message_parts[1]);
        }
},

onInput: function(client, parts) 
{
	//The input commands come in like u-l,
        //so we split them up into separate commands,
        //and then update the players
        var input_commands = parts[1].split('-');
        var input_time = parts[2].replace('-','.');
        var input_seq = parts[3];

        //the client should be in a game, so
        //we can tell that game to handle the input
        if(client && client.game && client.game.gamecore) 
	{
        	client.game.gamecore.handle_server_input(client, input_commands, input_time, input_seq);
        }
},

//Define some required functions
createGame: function(player) 
{
	//Create a new game instance
	var thegame = new ServerGame(player);

        //Store it in the list of game
        this.games[ thegame.id ] = thegame;

        //Keep track
        this.game_count++;

        //Create a new game core instance, this actually runs the
        //game code like collisions and such.
        thegame.gamecore = new ServerCore( thegame );
        //Start updating the game loop on the server
        thegame.gamecore.update( new Date().getTime() );

        //tell the player that they are now the host
        //s=server message, h=you are hosting

        player.send('s.h.'+ String(thegame.gamecore.local_time).replace('.','-'));
        console.log('server host at  ' + thegame.gamecore.local_time);
        player.game = thegame;
        player.hosting = true;
        
        this.log('player ' + player.userid + ' created a game with id ' + player.game.id);

        //return it
        return thegame;
}, 

//we are requesting to kill a game in progress.
endGame: function(gameid, userid) 
{
	var thegame = this.games[gameid];

        if(thegame) 
	{
        	//stop the game updates immediate
            	thegame.gamecore.stop_update();
                
		//if the game has two players, the one is leaving
            	if(thegame.player_count > 1) 
		{

                	//send the players the message the game is ending
                	if(userid == thegame.player_host.userid) 
			{
                        	//the host left, oh snap. Lets try join another game
                    		if(thegame.player_client) 
				{
                            		//tell them the game is over
                        		thegame.player_client.send('s.e');
                            		//now look for/create a new game.
                        		this.findGame(thegame.player_client);
                    		}
                    
                	} 
			else 
			{
                        	//the other player left, we were hosting
                    		if(thegame.player_host) 
				{
                            		//tell the client the game is ended
                        		thegame.player_host.send('s.e');
                            		//i am no longer hosting, this game is going down
                        		thegame.player_host.hosting = false;
                            		//now look for/create a new game.
                        		this.findGame(thegame.player_host);
                    		}
                	}
		}

            	delete this.games[gameid];
            	this.game_count--;

            	this.log('game removed. there are now ' + this.game_count + ' games' );
       	} 
	else 
	{
        	this.log('that game was not found!');
        }
},

startGame: function(game) 
{
	//right so a game has 2 players and wants to begin
        //the host already knows they are hosting,
        //tell the other client they are joining a game
        //s=server message, j=you are joining, send them the host id
        game.player_client.send('s.j.' + game.player_host.userid);
        game.player_client.game = game;

        //now we tell both that the game is ready to start
        //clients will reset their positions in this case.
        game.player_client.send('s.r.'+ String(game.gamecore.local_time).replace('.','-'));
        game.player_host.send('s.r.'+ String(game.gamecore.local_time).replace('.','-'));
 
       	//set this flag, so that the update loop can run it.
        game.active = true;
},

findGame: function(player) 
{
	this.log('looking for a game. We have : ' + this.game_count);

        //so there are games active,
        //lets see if one needs another player
        if(this.game_count) 
	{
        	var joined_a_game = false;

                //Check the list of games for an open game
            	for(var gameid in this.games) 
		{
                	//only care about our own properties.
                	if (!this.games.hasOwnProperty(gameid)) 
			{
				continue;
			}
                    	//get the game we are checking against
                	var game_instance = this.games[gameid];

                    	//If the game is a player short
                	if (game_instance.player_count < 2) 
			{
                        	//someone wants us to join!
                    		joined_a_game = true;
                        	//increase the player count and store
                        	//the player as the client of this game
                    		game_instance.player_client = player;
                    		game_instance.gamecore.playersArray[1].instance = player;
                    		game_instance.player_count++;

                        	//start running the game on the server,
                        	//which will tell them to respawn/start
                    		this.startGame(game_instance);
                	} //if less than 2 players
            	} //for all games

                //now if we didn't join a game,
                //we must create one
            	if(!joined_a_game) 
		{
                	this.createGame(player);
            	} //if no join already
	} 
	else 
	{ //if there are any games at all
       		//no games? create one!
            	this.createGame(player);
        }
} 
});

module.exports = Server;

