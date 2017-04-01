// ==UserScript==
// @name         IdleLandDrunkStumbler
// @namespace    http://tampermonkey.net/
// @version      0.23
// @require     http://ajax.googleapis.com/ajax/libs/jquery/2.1.1/jquery.min.js
// @description  Guide your "hero" using the power of alcohol!
// @author       commiehunter
// @match        http://idle.land/
// @grant        none
// @history 	0.23 pathfider change for guaranteed best path, show battle log in console
// ==/UserScript==

(function() {
    'use strict';

/*

============================================================================================
400lb h2x0rz Guild is now hiring.
* Must understand javascript and git, be able to understand and improve on this script
* Weighing exactly 400lb is an advantage, plus points also given for living in a basement, like all the proper wizards do
============================================================================================
0.22  * Turned off most of console spam
      * Added choices handlers
0.21  * Removed defunct settings
      * Fixed map loading check
      * XP gain indicator
      * LeavePartyIfNotLeaderAndHaveTarget defaults to false
0.20  * Renamed to .user.js
      * Turned off pet gold collection as default
0.19  * Advertisement added
0.18  * Unreachable paths handled
0.17  * More complex targeting
      * Settings
      * Save and load settings

0.16  * Tweaks
0.15  * Tweaks
0.14  * Fix cleaner
0.13  * Optimize
0.12  * Stronger alcohol! optimized pathfinder - stumble over whole Norkos!
0.11  * Step into the 21st century and clean cache before OOM happens!
      * Attempt at fixing map loading on map change
      
0.10  * Cached map now properly reloaded on map change 
0.09  * Multi pass path calculation 
0.08: * Path calculation now every tick
     
0.07: * Does not require the MapRenderComponent instance while running any more
     * Apparently not all "blockers" were actually blockers
*/

    //CTRL+click on the map to set repeating target
    //click on the map to set a target to be visited once
    //long click on the map to clear targets for current map
    //
    console.log("IdleLandDrunkStumbler active");
    var _previousDistance = null;
    $ = jQuery = jQuery.noConflict(true);
	function DrunkStumblerSettings(){
		var key = "DrunkStumblerSettings";
		this.load = function(){
			var str = localStorage.getItem(key);
			if (str){
				var deserialised = JSON.parse(str);
				if (deserialised){
					Object.keys(this).forEach(function(k){
						if (deserialised.hasOwnProperty(k)){
							this[k] = deserialised[k];
						}
					},this);
				}
			}
		};
		this.save = function(){
			var str = JSON.stringify(this);
			localStorage.setItem(key, str);
		};
		//Clears targets for map if specified, all targets otherwise
		this.clearTargets = function(map){
			if (map){
				if (this.MapTargets && this.MapTargets[map]){
					delete this.MapTargets[map];
				}
			}else{
				this.MapTargets = {};
			}
		};
		//Expect
		// x,y,[map],[repeat]
		// object with the same keys
		this.setTarget = function(){
            var targetObject = 0;
            var app = _cp.MyApp;
            var player = app.state.player.value;
            var map = player.map;
            var repeat = false;
			if (arguments.length >= 2){
                if (arguments.length >2){
                    if(arguments[2]){
                        map = arguments[2];
                    }
                }
                if (arguments.length >3){
                    repeat = arguments[3];
                }
                targetObject = {map: map, x: arguments[0], y:arguments[1], repeat:repeat};
			}else{
                targetObject = arguments[0];
			}
            if (!this.MapTargets[targetObject.map] || !_.isArray(this.MapTargets[targetObject.map])){
                this.MapTargets[targetObject.map] = [];
            }
            this.MapTargets[targetObject.map].push(targetObject);
		};
		Object.defineProperties(this, {
		  'LeavePartyIfNotLeaderAndHaveTarget': {
			value: false,
			writable: true, enumerable:true,
		  },
		  'ConfiscatePetGold': {
			value: false,
			writable: true, enumerable:true,
		  },
		  'MapTargets': {
			value: {},
			writable: true, enumerable:true,
		  },
          'Choices': {
			value: {},
			writable: true, enumerable:true,
		  },
		});
	}
	window.DrunkStumblerSettings = DrunkStumblerSettings;
	if (!window.DrunkStumblerSettingsInstance){
		window.DrunkStumblerSettingsInstance = new DrunkStumblerSettings();
	}
	var _settings = window.DrunkStumblerSettingsInstance;
	_settings.load();
    //
    //XP CALCULATOR
    //
    function XPCalculator(){
        this.maxGainLen = 100;
        this.gains = [];
        this.ticks = [];
        this.maxTickLen = 10;
        this.lastXP = null;
        this.mean = 0;
        this.lastGain = 0;
        this.lastTick = 0;
        this.tickDuration = 0;
        this.lastMaximum = 0;
        this.update = function(player){
            var currentXP = player._xp.__current;
            var tick = Date.now();
            if (this.lastTick){
                this.ticks.push(tick - this.lastTick);
                while (this.ticks.length> this.maxTicksLen){
                    this.ticks.shift();
                }
                if (this.ticks.length){
                    this.tickDuration = _.mean(this.ticks);
                }
            }
            this.lastTick = tick;
            if (this.lastXP){
                if (this.lastMaximum && this.lastMaximum != player._xp.maximum){
                    this.lastXP = 0; //reset last XP since we just gained a level
                }
                var gain = currentXP - this.lastXP;
                this.gains.push(gain);
                while (this.gains.lenght> this.maxGainLen){
                    this.gains.shift();
                }
                this.maximum = player._xp.maximum;
                this.mean = Math.floor(_.mean(this.gains));
                this.lastGain = gain;
            }
            this.lastXP = currentXP;
            this.lastMaximum = player._xp.maximum;
        };
        this.display = function(){
            if (!this.lastGain){
                return "";
            }
            var sign = this.lastGain >0? "+":"";
            var tickDuration = this.tickDuration ? this.tickDuration: 5000;
            var gainDisplay = {};
            var xpNeeded = this.lastMaximum - this.lastXP;
            gainDisplay.second = {gain: 1000 * this.mean / tickDuration};
            gainDisplay.second.toLevel = xpNeeded/Math.max(1,gainDisplay.second.gain);
            gainDisplay.minute = {gain: gainDisplay.second.gain * 60};
            gainDisplay.minute.toLevel = xpNeeded/Math.max(1,gainDisplay.minute.gain);
            gainDisplay.hour = {gain: gainDisplay.minute.gain * 60};
            gainDisplay.hour.toLevel = xpNeeded/Math.max(1,gainDisplay.hour.gain);
            gainDisplay.day = {gain: gainDisplay.hour.gain * 24};
            gainDisplay.day.toLevel = xpNeeded/Math.max(1,gainDisplay.day.gain);
            var gainUnit = "minute";
            var xpGainText = `${Math.round(gainDisplay[gainUnit].gain)} p/${gainUnit}`;
            var toLevelUnit = "minute";
            var xpToLevelText = `${Math.round(gainDisplay[toLevelUnit].toLevel)} ${toLevelUnit}${gainDisplay[toLevelUnit].toLevel>1?"s":""}`;
            return `XP:${this.lastXP}/${this.maximum} ${sign}${this.lastGain}, ${xpGainText} Next level in ${xpToLevelText} )`;
        };
    }
    var _xpCalculator = new XPCalculator();
    //
    //Chooser
    //
    function PlayerUpdateHandler_Choices(){
        this.update = function(player){
            if (!player.choices || !player.choices.length){
                return;
            }
            if (!_settings.Choices || !Object.keys(_settings.Choices).length){
                return;
            }
            var app = _cp.MyApp;
            var pet = app.state.petactive.value;
            var eq = app.state.equipment.value;
            var choiceDone = false;
            _.forEach(player.choices, function(choice){
                var handler = _settings.Choices[choice.event];
                if (!handler){
                    //console.log(`no handler for ${choice.event}`);
                    return true;
                }
                _.forEach(choice.choices, function(possibleAction){
                    var actionHandler = handler[possibleAction];
                    if (!actionHandler){
                        //console.log(`no action handler for ${choice.event}.${possibleAction}`);
                        return true;
                    }
                    var result = false;
                    try{
                        var compiledHandler = new Function('data','app','pet','eq','player', `return ${actionHandler}`);
                        result = compiledHandler(choice.extraData, _cp.MyApp, _cp.MyApp.state.petactive.value, _cp.MyApp.state.equipment.value, player);
                        //console.log(`handler ${choice.event}.${possibleAction} result:${result} |${actionHandler}|`);
                    }catch(e){
                        console.log(`handler ${choice.event}.${possibleAction} error:${e} |${actionHandler}|`);
                    }
                    if (result){
                        //perform choice here
                        console.log(`CHOICE WAS ACCEPTED: ${choice.event}.${possibleAction}|${actionHandler}|`);
                        _cp.MyApp.primus.makeChoice(choice.id, possibleAction);
                        choiceDone = true;
                        return false; //Do not proceed
                    }
                    return true;
                });
                if (choiceDone){
                    return false; //only one choice per tick to be safe
                }
                return true;
            });
        };
    }
    var _playerUpdateHandler_Choices = new PlayerUpdateHandler_Choices();
    //
    //Angular component finder
    //
    function ComponentProvider(){
        this.find = function (search){
            var n = ng.probe($(search)[0]);
            if (n){
                return n.componentInstance;
            }
           return null;
        };
        this.init = function(){
            Object.defineProperties(ComponentProvider.prototype, {
                MapRendererComponent: {
                    get: function () {
                        return this.find("map-renderer");
                 }},

                MapPage : {
                    get: function () {
                        return this.find("page-map");
                }},
                MyApp : {
                    get: function () {
                        return this.find("ng-component");
                }},
            });
        };
    }
    //
    var _cp = new ComponentProvider();
    _cp.init();
    var _currentCachedMap = null;
    //
    function reloadCachedMap(){
        var mr = _cp.MapRendererComponent;
        if (mr){
            var currentMap = mr.player.map;
            if (_currentCachedMap && _currentCachedMap.mapName == currentMap){
                return;
            }
            _currentCachedMap = null;
            _currentCachedMap = mr.phaser.cache.getTilemapData(currentMap);
            if (!_currentCachedMap){
                mr.phaser.load.tilemap(mr.player.map, mr.game.baseUrl+ "/maps/world-maps/" + mr.player.mapPath, null, window.Phaser.Tilemap.TILED_JSON);
                _currentCachedMap = mr.phaser.cache.getTilemapData(currentMap);
            }
            if (_currentCachedMap){
                _currentCachedMap.mapName = currentMap;
            }
        }
    }
    function initMap(){
        console.log("initMap");
        var mapInstance = _cp.MapPage;
        if (!mapInstance){
            return;
        }
        reloadCachedMap();
        var mapCanvas = $("canvas");
        mapCanvas[0].addEventListener("mousedown", handleDrunkWalkTargets);
        mapCanvas[0].addEventListener("mouseup", handleDrunkWalkTargets);
    }
    function PathFinder(){
        this._maxNoneScoredCount = 10;
        this._maxRunTimeMs = 500;
        this._state = null;
        this._currentIdx = null;
        this._currentRadius = 0;
        this._cachedPaths = {};
        this._unwalkableVal = 100000000;
        this._cacheTTL = 60 * 60 * 1000;
        this.cleanCache = function (){
            var me = this;
            _.forEach(this._cachedPaths, function(cp, idx){
                var tNow = (new Date()).getTime();
                if (cp.lastUsedTime + me._cacheTTL < tNow){
                    delete me._cachedPaths[idx];
                    console.log("cleaned path " + idx + " from cache");
                }
            });
        };
        //Updates path when needed
        this.findPath = function(target){
            this.cleanCache();//TODO: less often
            if (!target){
                return; //nothing to do
            }
            var app = _cp.MyApp;
            var player = app.state.player.value;
            var currentMap = player.map;
            if (!_currentCachedMap || _currentCachedMap.mapName != currentMap){
                reloadCachedMap();
            }
            if (!_currentCachedMap || _currentCachedMap.mapName != currentMap){
                console.log("ERROR, failed to load map data for " + currentMap);
                return; //no map cache
            }
            var startTime = (new Date()).getTime();
            var data = _currentCachedMap.data;
            var t = data.layers[0]; //terrain
            var b = data.layers[1]; //blockers
            var cacheKey = currentMap + "_" + target.x + "_" + target.y;
            var currentPath = this._cachedPaths[cacheKey];
            var targetIdx = this.coordsToIndex(target, data);
            if (!currentPath){
                this._cachedPaths[cacheKey] = currentPath = {
                    target: target,
                    targetIdx: targetIdx,
                    data : [],
                    radius: 1,
                    done: false,
                    width: data.width,
                    createdTime:startTime,
                    scoreQueue:[],
					runCount:0,
                    allScored:false
                };
            }
			currentPath.runCount++;
            currentPath.data[targetIdx] = 1;
            currentPath.lastUsedTime = startTime;
            //
            var killTime = startTime + this._maxRunTimeMs;
            //
            var tNow = 0;
            //
            var playerNeighbours = this.circleIndexes(player, 1, b);
            currentPath.done  = _.every(playerNeighbours, function(n){
                if(currentPath.data[n.i] === undefined){
                    currentPath.data[n.i] = -b.data[n.i];
                }
                return currentPath.data[n.i] !== undefined && currentPath.data[n.i] !== 0;
            });
            if (currentPath.done || currentPath.allScored){
                return currentPath; //done
            }
            var maxRadius = Math.max(data.height, data.width);
            var me = this;
            tNow = (new Date()).getTime();
            var dbgArray = [];
            var loopIdx = 0;
            while(tNow < killTime && !currentPath.done && !currentPath.allScored){
                var dbg = {}; dbgArray.push(dbg);
                var added = 0;
                loopIdx++;
                if (currentPath.radius < maxRadius){
                    var currentCircle = this.circleIndexes(currentPath.target, currentPath.radius, b);
                    _.forEach(currentCircle, function(cell){
                        currentPath.data[cell.i] = -b.data[cell.i];
                        if (currentPath.data[cell.i] ===0){
                            currentPath.scoreQueue.push(cell);
                            added++;
                        }
                        return true;
                    });
                }
                var noneScored = true;
                var ql = currentPath.scoreQueue.length;
                var noneScoredThisIteration = false;
                var largestScoreThisLoop = 0;
                var betterPaths = 0;
                while(!noneScoredThisIteration){
                    var reverse = (loopIdx + currentPath.runCount) % 2 === 0;
                    var scoreKeys = Object.keys(currentPath.scoreQueue);
                    var startIdx = 0;
                    var endIdx = scoreKeys.length;
                    var inc = 1;
                    if (reverse){
                        startIdx = scoreKeys.length -1;
                        endIdx = -1;
                        inc = -1;
                    }
                    noneScoredThisIteration = true;
                    for (var i = startIdx; i != endIdx; i+=inc){
                        var queueIndex = scoreKeys[i];
                        var cell = currentPath.scoreQueue[queueIndex];
                        var cellNeighbours = cell.neighbours;
                        if (!cellNeighbours){
                            cellNeighbours = cell.neighbours = me.circleIndexes(cell, 1, b);
                        }
                        var scorableWalkableNeigbours = [];
                        var scoredWalkableNeighbours = [];
                        _.forEach(cellNeighbours, function(cn){
                            if (currentPath.data[cn.i] > 0){
                                scoredWalkableNeighbours.push(cn);
                            }
                            if(currentPath.data[cn.i] >= 0){
                                scorableWalkableNeigbours.push(cn);
                            }
                        });
                        if (scoredWalkableNeighbours.length){
                            var neighboursByScore = _.sortBy(scoredWalkableNeighbours, function(cn){
                                return currentPath.data[cn.i];
                            });
                            var bestNeighbourCell = _.first(neighboursByScore);
                            var bestNeighbourScore = currentPath.data[bestNeighbourCell.i];
                            var ourScore = bestNeighbourScore + 1;
                            largestScoreThisLoop = Math.max(largestScoreThisLoop, ourScore);
                            currentPath.data[cell.i] = ourScore;
                            delete currentPath.scoreQueue[queueIndex];
                            noneScored = false;
                            noneScoredThisIteration = false;
                            if (scorableWalkableNeigbours.length > 1){ //Can also rescore some of the neighbours
                                _.forEach(scorableWalkableNeigbours, function(cn){
                                    if (currentPath.data[cn.i] === 0){ //not scored, award ours + 1
                                        currentPath.data[cn.i] = ourScore + 1;
                                    }else if (currentPath.data[cn.i] > ourScore +1){
                                        currentPath.data[cn.i] = ourScore + 1; // alternative, better path found
                                        currentPath.scoreQueue.push(cn);
                                        betterPaths++;
                                    }
                                });
                            }
                        }
                    }
                }
                currentPath.scoreQueue = _.compact(currentPath.scoreQueue);
                //dbg.info = "R: "+ currentPath.radius + " QL:" + ql + "->" + currentPath.scoreQueue.length +" LScore: " + largestScoreThisLoop + " betterPaths:" + betterPaths + " reverse:"+reverse;
                //Loop end
                currentPath.radius++;
                currentPath.radius = Math.min(currentPath.radius, maxRadius);
                currentPath.done  = _.every(playerNeighbours, function(n){
                    //console.log("N:" + JSON.stringify(n) + " s:" + currentPath.data[n.i]);
                    return currentPath.data[n.i] !== undefined && currentPath.data[n.i] !== 0;
                });
                if (noneScored){
                    currentPath.allScored = true;
                    console.log("Path all done, with %s items left in score queue",currentPath.scoreQueue.length);
                    currentPath.scoreQueue = []; //clear it
                }
                tNow = (new Date()).getTime();
            }
            console.log("PF loop done in "+ (tNow - startTime) + "ms R:"+currentPath.radius +"(" + maxRadius + ") done:"+currentPath.done + " runCount:" +currentPath.runCount + " qlen:"+currentPath.scoreQueue.length, currentPath,"Dbg:", dbgArray);
            return currentPath;
        };

        this.circleIndexes = function(centre, radius, data){
         var y = 0;
         var x = 0;
         var n = {}; //Using a dictionary here, since this way we can easily get rid of duplicated corner coords
         var c = null;
         var maxX = data.width - 1;
         var maxY = data.height - 1;
         // We do these in a circle, so we can do a second pass in reverse
         // Top row
         y = centre.y - radius;
         if (y >= 0){
             for(x = Math.max(centre.x - radius, 0); x<= Math.min(centre.x + radius, maxX); x++){
                 c = {x: x, y: y};
                 c.i = this.coordsToIndex(c, data);
                 n[c.i] = c;
             }
         }
          // Right side
         x = centre.x + radius;
         if (x <= maxX){
             for (y = Math.max(centre.y - radius,0); y <= Math.min(centre.y + radius, maxY); y++){
                 c = {x: x, y: y};
                 c.i = this.coordsToIndex(c, data);
                 n[c.i] = c;
             }
         }
         //Bottom row
         y = centre.y + radius;
         if (y <= maxY){
             for(x = Math.min(centre.x + radius, maxX); x >= Math.max(centre.x - radius, 0) ; x--){
                 c = {x: x, y: y};
                 c.i = this.coordsToIndex(c, data);
                 n[c.i] = c;
             }
         }
         //Left side
         x = centre.x - radius;
         if (x >= 0){
             for (y = Math.min(centre.y + radius, maxY); y >= Math.max(centre.y - radius, 0) ; y--){
                 c = {x: x, y: y};
                 c.i = this.coordsToIndex(c, data);
                 n[c.i] = c;
             }
         }
        return _.values(n);
     };
     this.neighbourIndexes = function(idx, data){
         var c = this.indexToCoords(idx,data);
         var n = [];
         _.forEach(this.neighbourMap, function(delta){
             var nc = {x: delta.x + c.x, y: delta.y + c.y};
             if (this.isCoordsValid(nc,data)){
                 var toIndex = this.coordsToIndex(nc, data);
                 n.push(toIndex);
             }
         });
         return n;
     };
     this.neighbourMap = [{x:-1,y:-1},{x: 0,y:-1},{x: 1,y:-1},
                          {x:-1,y: 0},            {x: 1,y: 0},
                          {x:-1,y: 1},{x: 0,y: 1},{x: 1,y: 1}];
     this.isCoordsValid = function(nc, data){
         if (nc.x >= 0 && nc.x < data.width && nc.y >= 0 && nc.y < data.height){
             return true;
         }
         return false;
     };
     this.indexToCoords = function(index, data){
         var y = index % data.width;
         return {x: index - y, y:y, i:index };
     };
     this.coordsToIndex = function(coords, data){
         return coords.x + coords.y * data.width;
     };
    }
    var _pf = new PathFinder();
    function distance(c0, c1){
        var sqr = Math.pow(c0.x - c1.x,  2) + Math.pow(c0.y - c1.y, 2);
        if (sqr === 0){
            return 0;
        }
        return Math.sqrt(sqr);
    }
    function getCoordsFromString(t, fromText){
        var startTarget = t.indexOf(fromText);
        if (startTarget > 0){
            var targetStr =  t.substring(startTarget + fromText.length);
            //console.log("target str :"+targetStr);
            var coords = targetStr.split(", ");
            var x = parseInt(coords[0]);
            var y = parseInt(coords[1]);
            //console.log("have coords:", x,y);
            return {x:x, y:y};
        }
        return null;
    }
    var _clearTargetTimeoutId = 0;
    var _clearTargetTimeoutLengthInMs = 1000;
    function handleDrunkWalkTargets(evt){
        //console.log(evt);
        if (evt.type == "mousedown"){
            clearTimeout(_clearTargetTimeoutId);
            _clearTargetTimeoutId = setTimeout(function(){
                var app = _cp.MyApp;
                var player = app.state.player.value;
                var mapName = player.map;
                _settings.clearTargets(mapName);
                _settings.save();
                console.log("CLEARED targets for %s", mapName);
                setMapTitle("CLEARED TARGETS FOR " + mapName);
                _clearTargetTimeoutId = null;
            }, _clearTargetTimeoutLengthInMs);
        }else if (evt.type == "mouseup"){
            if (_clearTargetTimeoutId){
                setDrunkWalkTargets(evt);
            }
            clearTimeout(_clearTargetTimeoutId);
        }
    }
    function setDrunkWalkTargets(evt){
        var app = _cp.MyApp;
        var player = app.state.player.value;
		var mapName = player.map;
        var mapInstance = _cp.MapPage;
        if (!mapInstance){
            return;
        }
        var t = mapInstance.mapText;
        var tc = getCoordsFromString(t, "Hovering ");
        tc.map = player.map;
        tc.mapRegion = player.mapRegion;
        tc.repeat = evt.ctrlKey; //Add a repeating target if ctrl is held
        _settings.setTarget(tc);
        console.log("ADDED TARGET FOR %s [%s,%s] Repeating:%s", mapName,tc.x,tc.y, tc.repeat);
        _settings.save();
    }
    function handlePet(){
        if (!_settings.ConfiscatePetGold){
            return;
        }
         var app = _cp.MyApp;
         var petGold = app.state.petactive.value.gold.__current;
         if (petGold){
             console.log("CONFISCATING %s PET GOLD", petGold);
             app.primus.takePetGold();
         }
    }
    var _prevCoords = null;
    function drunkWalkCheckPulse(updatedData){
        handlePet();//TODO: own timer
        var app = _cp.MyApp;
        var player = app.state.player.value;
        var party = app.state.party.value;
		var currentMapName = player.map;
        var targetArray = _settings.MapTargets[currentMapName];
		if (!targetArray || targetArray.length === 0){
            setMapTitle(`NO TARGET ${_xpCalculator.display()}`);
			return;
		}
        var target = targetArray[0];
        if (party.players && party.players.length){
            if (party.players[0].shortName != player.name){
                if (_settings.LeavePartyIfNotLeaderAndHaveTarget){
                    console.log("LEAVING PARTY, SINCE WE HAVE A TARGET");
                    app.primus.leaveParty();
                }else{
                    //console.log("ERROR. NOT A PARTY LEADER. WON'T STUMBLE!");
                }
                setMapTitle(`CAN'T STUMBLE ${_xpCalculator.display()}`);
                return;
            }
        }
        var newCoords = {x: player.x, y: player.y, map:currentMapName, mapRegion:player.mapRegion};
        if (newCoords.x == target.x && newCoords.y == target.y){
            targetArray.shift();
            if (target.repeat){
                targetArray.push(target);
            }
            var arrivedText = "ARRIVED @ "+JSON.stringify(target)  + " REPEATING:" + target.repeat;
            setMapTitle(arrivedText); console.log(arrivedText);
            return;
        }
        var stumbledUsingPath = false;
        var path = false;
        var currentScore = 0;
        var projectedScore = 0;
        var projectedCoords = {};
        if (_prevCoords){
               path = _pf.findPath(target);
               if (_prevCoords.x == newCoords.x && _prevCoords.y == newCoords.y){
                   return; //hasn't moved yet
               }
               if (path && !path.done && path.allScored){
                   console.log("current target %s unreachable at the moment, moving to the back", JSON.stringify(target));
                   targetArray.shift();
                   targetArray.push(target);
                   return;
               }
               var dx = newCoords.x - _prevCoords.x;
               var dy = newCoords.y - _prevCoords.y;
                var currentDistance = distance(newCoords, target);
                var newDrunkState = null;
                //console.log("DX:%s DY:%s PREVD:%s",dx,dy,_previousDistance);
                if (_previousDistance && Math.abs(dx)<=1 && Math.abs(dy)<=1){
                    projectedCoords = {x:newCoords.x + dx, y:newCoords.y + dy};
                    if (path && path.done){
                        stumbledUsingPath = true;
                        projectedCoords.i = projectedCoords.y * path.width + projectedCoords.x;
                        newCoords.i = newCoords.y * path.width + newCoords.x;
                        newCoords.i = newCoords.y * path.width + newCoords.x;
                        var data = _currentCachedMap.data;
                        var b = data.layers[1]; //blockers
                        var walkableNeighbours = _pf.circleIndexes(newCoords, 1, b);
                        var ourTargetCellNeighbour = null;
                        var nextStepNotBlocked = false;
                        var nextLikelyNonDrunkTargets = [];
                        currentDistance = currentScore = path.data[newCoords.i];
                        _.forEach(walkableNeighbours, function(cn, i){
                            cn.order = i; //0 - 7
                            cn.score = path.data[cn.i];
                            if (cn.i == projectedCoords.i){
                                ourTargetCellNeighbour = cn;
                                if (path.data[cn.i] > 0){
                                    nextLikelyNonDrunkTargets.push(cn);
                                }
                            }
                        });
                        walkableNeighbours = _.filter(walkableNeighbours, function(cn){
                            return path.data[cn.i] > 0;
                        });
                        var orderDiff = 0;
                        while(!nextLikelyNonDrunkTargets.length && orderDiff<3){
                            orderDiff++;
                            var o1 = ourTargetCellNeighbour.order - orderDiff;
                            var o2 = ourTargetCellNeighbour.order + orderDiff;
                            if (o1 < 0){
                                o1 = 7;
                            }
                            if (o2>7){
                                o2 = 0;
                            }
                            nextLikelyNonDrunkTargets = _.filter(walkableNeighbours, function(cn){
                                return cn.order == o1 || cn.order == o2;
                            });
                        }
                        projectedScore = _.minBy(nextLikelyNonDrunkTargets, function(cn){
                            return cn.score;
                        }).score;
                        var previousScore = path.data[_prevCoords.i];
                        newDrunkState = previousScore <= projectedScore;
                    }else{
                        if (currentDistance <= _previousDistance){
                            var projectedDistance = distance(projectedCoords, target);
                            if (projectedDistance < currentDistance){
                                newDrunkState = false;
                            }else{
                                newDrunkState = true;
                            }
                        }else{
                            newDrunkState = true;
                        }
                    }
                    setDrunkState(newDrunkState);
                }
                _previousDistance = currentDistance;
                var displayDistance = Math.round(currentDistance * 100)/100;
                var targetText = _.join(_.map(targetArray, function(t){ return "[" + t.x + "," + t.y + "]"+ (t.repeat? "*":""); }),", ");
                var mapTitle = "TARGET:"+ targetText + " D:" + displayDistance + " DRUNK:" + newDrunkState + " PATH:" + stumbledUsingPath + " "+_xpCalculator.display();
                //console.log("moving from "+ newCoords.x + ", "+ newCoords.y +  " to " + mapTitle + " current tile score: "+ currentScore + " next tile: "+ projectedScore + "["+ projectedCoords.x + ","+ projectedCoords.y +"]");
                setMapTitle(mapTitle);
        }
        _prevCoords = newCoords;
    }
    function toggleDrunk(primus){
        primus.togglePersonality("Drunk");
    }
    function setDrunkState(targetState){
        var app = _cp.MyApp;
        var currentDrunkState = app.state.personalities.value.active.Drunk;
        //console.log("Current drunk:" + currentDrunkState + " target:" + targetState);
        if (targetState != currentDrunkState){
            //console.log("Toggling Drunk");
            toggleDrunk(app.primus);
        }
    }
    //
    function setMapTitle(titleContent){
        $("page-map ion-title .toolbar-title").text(titleContent);
    }
    //
    function mainInit(){
        window.PhaserGlobal = {   hideBanner: true }; //hide phaser.io spam
        console.log("mainInit");
        window.socket.on("data", function(data){
            if (data.update == "player"){
                _xpCalculator.update(data.data);
                drunkWalkCheckPulse(data.data);
                _playerUpdateHandler_Choices.update(data.data);
            }
            if (data.update == "battle"){
                _.forEach(_.take(_.reverse(data.data.messageData), 20), function(battleMessage){
                    console.log(`BATTLE TAIL: ${battleMessage.message}`);
                    if (battleMessage.message == "Battle complete."){
                        return false;
                    }
                    return true;
                });
            }
        });
        var target = document.getElementsByTagName('ion-nav')[0];
        // create an observer instance
        var observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.addedNodes.length){
                    if (mutation.addedNodes[0].nodeName == "PAGE-MAP"){
                        //entered map
                        setTimeout(initMap, 100);
                    }

                }
                if (mutation.removedNodes.length){
                    if (mutation.removedNodes[0].nodeName == "PAGE-MAP"){
                        //left map
                    }

                }
            });
        });
        // configuration of the observer:
        var config = { attributes: true, childList: true, characterData: true };

        // pass in the target node, as well as the observer options
        observer.observe(target, config);
        initMap();
    }
    setTimeout(mainInit, 5000); //load after 5 seconds
})();
