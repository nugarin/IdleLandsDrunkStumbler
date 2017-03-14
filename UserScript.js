// ==UserScript==
// @name         IdleLandDrunkStumbler
// @namespace    http://tampermonkey.net/
// @version      0.10
// @require     http://ajax.googleapis.com/ajax/libs/jquery/2.1.1/jquery.min.js
// @description  Guide your "hero" using the power of alcohol!
// @author       commiehunter
// @match        http://idle.land/
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
/*
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
            _currentCachedMap.mapName = currentMap;
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
        this._maxRunTimeMs = 100;
        this._state = null;
        this._currentIdx = null;
        this._currentRadius = 0;
        this._cachedPaths = {};
        this._unwalkableVal = 100000000;
        
   
        //Updates path when needed
        this.findPath = function(){
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
                    radius: 0,
                    done: false,
                    width: data.width,
                    createdTime:startTime,
                };
            }
            currentPath.data[targetIdx] = 1;
            currentPath.lastUsedTime = startTime;
            //
            var killTime = startTime + this._maxRunTimeMs;
            //
            var tNow = 0;
            //
            var playerNeighbours = this.circleIndexes(player, 1, b);
            currentPath.done  = _.every(playerNeighbours, function(n){
                return currentPath.data[n.i] !== undefined && currentPath.data[n.i] !== 0;
            });
            if (currentPath.done ){
                return currentPath; //done
            }
            var maxRadius = Math.max(data.height, data.width) - 1;
            
            var r = currentPath.radius; //start from here
            var dbgInfo = {secondPassCount :0};
            var dbgStats = dbgInfo.stats = [];
            var me = this;
            do{
                r++;
                var dbg = {r: r, passStats:[]};
                dbgStats.push(dbg);
                var currentCircle = this.circleIndexes(_target, r, b);
                var noneFoundThisCircle = true;
                var allDoneThisCircle = true;
                //
                var passes = [currentCircle, _.reverse(currentCircle)]; //reverse pass for mazes
                //
                _.forEach(passes, function(currentPass, passIndex){
                    var dbgCurrPass = dbg.passStats[passIndex] = {};
                    var blockedCountThisPass = 0; //Count cells that were marked blocked from this circle only, exclude neighbour loading
                    var scoredCountThisPass = 0;
                    var alreadyScoredThisPass = 0;
                    _.forEach(currentPass, function(cell){
                        var blockValue = parseInt(b.data[cell.i]);
                        if (blockValue > 0){
                            currentPath.data[cell.i] = -blockValue;
                            blockedCountThisPass++;
                        }else{
                            if (!currentPath.data[cell.i] || !isNaN(currentPath.data[cell.i])){
                                currentPath.data[cell.i] = 0;
                            }
                            if (!currentPath.data[cell.i]){ //is ist scored yet?
                                var cellNeighbours = me.circleIndexes(cell, 1, b);
                                var scorableWalkableNeigbours = [];
                                var scoredWalkableNeighbours = [];
                                _.forEach(cellNeighbours, function(cn){
                                    if (currentPath.data[cn.i] === undefined){
                                        currentPath.data[cn.i] = -b.data[cn.i]; //load from blocked
                                    }
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
                                    currentPath.data[cell.i] = ourScore;
                                    scoredCountThisPass++;
                                    if (scoredWalkableNeighbours.length > 1){ //Can also rescore some of the neighbours
                                        _.forEach(scoredWalkableNeighbours, function(cn){
                                            if (currentPath.data[cn.i] === 0){ //not scored, award ours + 1
                                                currentPath.data[cn.i] = ourScore + 1;
                                            }else if (currentPath.data[cn.i] > ourScore +1){
                                                currentPath.data[cn.i] = ourScore + 1; // alternative, better path found
                                            }
                                        });
                                    }
                                }
                            }else{
                                alreadyScoredThisPass++;
                            }
                        }
                    });
                    allDoneThisCircle = blockedCountThisPass + scoredCountThisPass + alreadyScoredThisPass == currentCircle.length;
                    var currentPassResults = _.map(currentPass, function(dn){
                        var score = currentPath.data[dn.i];
                        var dobj = {x: dn.x, y:dn.y, i: dn.i, score:score};
                        return dobj;
                    });
                    
                    dbgCurrPass.anomalous = _.reject(currentPassResults, function(dn){
                        return dn.score > 0 || dn.score <= -1;
                    });
                    
                    noneFoundThisCircle = scoredCountThisPass === 0;
                    dbgCurrPass.blockedCountThisPass = blockedCountThisPass;
                    dbgCurrPass.scoredCountThisPass = scoredCountThisPass;
                    dbgCurrPass.noneFoundThisCircle = noneFoundThisCircle;
                    dbgCurrPass.allDoneThisCircle = allDoneThisCircle;
                    dbgCurrPass.currentCircleLength = currentCircle.length;
                    dbgCurrPass.alreadyScoredThisPass = alreadyScoredThisPass;
                    if (scoredCountThisPass > 0 && !allDoneThisCircle){
                        dbgInfo.secondPassCount++;
                        return true; //Found some, but not all - do 2nd, reverse pass
                    }
                    return false; //No need for 2nd pass
                });
                // if (allDoneThisCircle && r<maxRadius){ TODO: fix and turn on again
                //     currentPath.radius = r; //no need to redo from scratch
                // }
                if (noneFoundThisCircle || r > maxRadius){
                    r = currentPath.radius; //reset radius to rewalk the maze
                }
                currentPath.done  = _.every(playerNeighbours, function(n){
                    return currentPath.data[n] !== undefined && currentPath.data[n] !== 0;
                });
                tNow = (new Date()).getTime();
            }while(tNow < killTime && !currentPath.done && r < maxRadius);
            console.log("PF loop done in "+ (tNow - startTime) + "ms R:"+r +"(" + maxRadius + ") done:"+currentPath.done, currentPath,"Dbg:", dbgInfo);
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
            _target = null;
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