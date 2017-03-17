// ==UserScript==
// @name         IdleLandDrunkStumbler
// @namespace    http://tampermonkey.net/
// @version      0.15
// @require     http://ajax.googleapis.com/ajax/libs/jquery/2.1.1/jquery.min.js
// @description  Guide your "hero" using the power of alcohol!
// @author       commiehunter
// @match        http://idle.land/
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

/*
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

    //Double click on the map to set target
    //Single click on the map to clear target
    
    
    console.log("IdleLandDrunkStumbler active");
    
    var _target = null;
    var _previousDistance = null;
    
    $ = jQuery = jQuery.noConflict(true);
    
    
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
            _currentCachedMap = mr.phaser.cache.getTilemapData(currentMap);
            if (_currentCachedMap){
                mr.phaser.load.tilemap(mr.player.map, mr.game.baseUrl+ "/maps/world-maps/" + mr.player.mapPath, null, window.Phaser.Tilemap.TILED_JSON);
                _currentCachedMap = mr.phaser.cache.getTilemapData(currentMap);
                if (_currentCachedMap){
                    _currentCachedMap.mapName = currentMap;
                }
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
        mapCanvas[0].addEventListener("dblclick", setDrunkWalkTarget);
        mapCanvas[0].addEventListener("click", clearDrunkWalkTarget);

        if (_target){
            var mapTitle = "Current target: " + _target.x + ", " + _target.y;
            setMapTitle(mapTitle);
        }
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
        this.findPath = function(){
            this.cleanCache();//TODO: less often
            if (!_target){
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
            var cacheKey = currentMap + "_" + _target.x + "_" + _target.y;
            var currentPath = this._cachedPaths[cacheKey];
            var targetIdx = this.coordsToIndex(_target, data);
            if (!currentPath){
                this._cachedPaths[cacheKey] = currentPath = {
                    target: _target,
                    targetIdx: targetIdx,
                    data : [],
                    radius: 1,
                    done: false,
                    width: data.width,
                    createdTime:startTime,
                    scoreQueue:[],
					runCount:0,
                    noneScoredCount:0,
                    invalid:false
                };
            }
            if (currentPath.invalid){
                console.log("ERROR: no path");
                return;
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
                    currentPath.data[n.i] = -b.data[nw.i];
                }
                return currentPath.data[n.i] !== undefined && currentPath.data[n.i] !== 0;
            });
            if (currentPath.done ){
                return currentPath; //done
            }
            var maxRadius = Math.max(data.height, data.width);
            var maxNoneScoredCount = Math.max(3, maxRadius/2);
            var me = this;
            tNow = (new Date()).getTime();
            var dbgArray = [];
            var loopIdx = 0;
            while(tNow < killTime && !currentPath.done && !currentPath.invalid){
                var dbg = {}; dbgArray.push(dbg);
                var added = 0;
                loopIdx++;
                if (currentPath.radius < maxRadius){
                    var currentCircle = this.circleIndexes(_target, currentPath.radius, b);
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
                var largestScoreThisLoop = 0;
                var reAddToQueue = [];
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
                var betterPaths = 0;
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
                currentPath.scoreQueue = _.compact(currentPath.scoreQueue);
                dbg.info = "R: "+ currentPath.radius + " QL:" + ql + "->" + currentPath.scoreQueue.length +" LScore: " + largestScoreThisLoop + " betterPaths:" + betterPaths + " reverse:"+reverse;
                //Loop end
                currentPath.radius++;
                currentPath.radius = Math.min(currentPath.radius, maxRadius);
                currentPath.done  = _.every(playerNeighbours, function(n){
                    //console.log("N:" + JSON.stringify(n) + " s:" + currentPath.data[n.i]);
                    return currentPath.data[n.i] !== undefined && currentPath.data[n.i] !== 0;
                });
                if ((currentPath.scoreQueue.length >= (ql -added)) && !currentPath.done){
                    //currentPath.noneScoredCount++;
                }else{
                    currentPath.noneScoredCount = 0;
                }
                tNow = (new Date()).getTime();
            }
            if (currentPath.noneScoredCount > maxNoneScoredCount){
                currentPath.invalid = true;
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
         if (y > 0){
             for(x = Math.max(centre.x - radius, 0); x<= Math.min(centre.x + radius, maxX); x++){
                 c = {x: x, y: y};
                 c.i = this.coordsToIndex(c, data);
                 n[c.i] = c;
             }
         }
          // Right side
         x = centre.x + radius;
         if (x < maxX){
             for (y = Math.max(centre.y - radius,0); y <= Math.min(centre.y + radius, maxY); y++){
                 c = {x: x, y: y};
                 c.i = this.coordsToIndex(c, data);
                 n[c.i] = c;
             }
         }
         //Bottom row
         y = centre.y + radius;
         if (y < maxY){
             for(x = Math.min(centre.x + radius, maxX); x >= Math.max(centre.x - radius, 0) ; x--){
                 c = {x: x, y: y};
                 c.i = this.coordsToIndex(c, data);
                 n[c.i] = c;
             }
         }
         //Left side
         x = centre.x - radius;
         if (x > 0){
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
    function clearDrunkWalkTarget(evt){
        console.log("clearing target");
        _target = null;
        setMapTitle("TARGET:NONE");
    }
    function setDrunkWalkTarget(){
        console.log("setting target");
        
        var app = _cp.MyApp;
        var player = app.state.player.value;
        
        var mapInstance = _cp.MapPage;
        if (!mapInstance){
            return;
        }
        var t = mapInstance.mapText;
        var tc = getCoordsFromString(t, "Hovering ");
        tc.map = player.map;
        tc.mapRegion = player.mapRegion;
        var cc = {x:player.x, y:player.y, map:player.map};
        if (tc){
            setMapTitle("Target X:" + tc.x + "[" + (tc.x - cc.x) + "] Y:" + tc.y + "["+ (tc.y - cc.y) + "]");
            _target = tc;
        }
        console.log("should drunk walk to " + mapInstance.mapText, tc, cc);
    }
    var _prevCoords = null;
    //Run on interval of 1 second
    function drunkWalkCheckPulse(){
        if (!_target){
            return;
        }
        var app = _cp.MyApp;
        var player = app.state.player.value;
        var party = app.state.party.value;
        if (party.players && party.players.length){
            if (party.players[0].shortName != player.name){
                console.log("ERROR. NOT A PARTY LEADER. CLEARING TARGET!");
                _target = null;
                return;
            }
        }
        var newCoords = {x: player.x, y: player.y, map:player.map, mapRegion:player.mapRegion};
        if (newCoords.x == _target.x && newCoords.y == _target.y){
            //_target = null;
            setMapTitle("ARRIVED!");
            return;
        }
        if (newCoords.map != _target.map) { // || newCoords.mapRegion != _target.mapRegion){
            _target = null;
            setMapTitle("ERROR, MAP changed - expected " + _target.map + "/" + _target.mapRegion + " but we are on "+ newCoords.map + "/" + newCoords.mapRegion);
            return;
        }
        var stumbledUsingPath = false;
        var path = false;
        var currentScore = 0;
        var projectedScore = 0;
        var projectedCoords = {};
        if (_prevCoords){
               path = _pf.findPath();
               if (_prevCoords.x == newCoords.x && _prevCoords.y == newCoords.y){
                   return; //hasn't moved yet
               }
                var currentDistance = distance(newCoords, _target);
                var newDrunkState = null;
                if (_previousDistance){
                    var dx = newCoords.x - _prevCoords.x;
                    var dy = newCoords.y - _prevCoords.y;
                    projectedCoords = {x:newCoords.x + dx, y:newCoords.y + dy};
                    if (path && path.done){
                        var projectedIndex = projectedCoords.y * path.width + projectedCoords.x;
                        projectedScore = path.data[projectedIndex];
                        var currentIndex = newCoords.y * path.width + newCoords.x;
                        currentScore = path.data[currentIndex];
                        if (projectedScore !== undefined && projectedScore !== 0){
                            stumbledUsingPath = true;
                            currentDistance = currentScore -1;
                            if (projectedScore < currentScore){
                                newDrunkState = false;
                            }else{
                                newDrunkState = true;
                            }
                        }
                    }

                    if(!stumbledUsingPath){
                        if (currentDistance <= _previousDistance){
                            var projectedDistance = distance(projectedCoords, _target);
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

                var mapTitle = "TARGET:"+ _target.x + ", " + _target.y + " D:" + displayDistance + " DRUNK:" + newDrunkState + " PATH:" + stumbledUsingPath;
                console.log("moving from "+ newCoords.x + ", "+ newCoords.y +  " to " + mapTitle + " current tile score: "+ currentScore + " next tile: "+ projectedScore + "["+ projectedCoords.x + ","+ projectedCoords.y +"]");
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
            console.log("Toggling Drunk");
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

        // later, you can stop observing
        //observer.disconnect();
        
        /*
how does one hook into the contentUpdate? have to replace and intercept the original function?
 var hookedHandleContentUpdate = primus.handleContentUpdate
 then you replace the original with your own
 return ev0_hookedHandleContentUpdate.apply(this, arguments);
 at the end of your hook
        */
        
        setInterval(drunkWalkCheckPulse, 1000);
        initMap();
        
    }
    
    setTimeout(mainInit, 5000); //load after 5 seconds
    
})();
